// Copyright (c) 2026 IoTone, Inc. All rights reserved.
// Licensed under the MIT License. See LICENSE.md in the project root.

import {BleKeyboard, KeypressData} from "./BleKeyboard"
import Event from "./Event"
import {JournalStore} from "./JournalTypes"
import {LocalJournalStore} from "./LocalJournalStore"
import {ScrollableTextEditor} from "./ScrollableTextEditor"

/**
 * JournalController — v1 single-buffer journal.
 *
 * On lens start: loads the persisted buffer, appends a new org-mode session
 * heading with timestamp + properties drawer, and hands the result to the
 * editor. User-typed characters are appended to the buffer and autosaved
 * after a short idle period.
 *
 * Public methods:
 *   - clearBuffer() — wipes the persisted buffer entirely (then inserts a
 *     fresh session heading so the user has something to write under).
 *
 * v2 plans (multi-entry, cloud sync, org-mode export) are documented in
 * DESIGN.md "Future Plans".
 */
@component
export class JournalController extends BaseScriptComponent {

    @input
    bleKeyboard: BleKeyboard

    @input
    @hint("ScrollableTextEditor view component")
    editor: ScrollableTextEditor

    @input
    @hint("Seconds of keyboard idle before autosave")
    autosaveDelay: number = 1.5

    @input
    @hint("Heading title for new sessions (org-mode '* ' headline). e.g., 'Session', 'Field observation'")
    sessionHeading: string = "Session"

    @input
    @hint("Org-mode tags for new session headings, colon-delimited without surrounding colons. e.g., 'skywriterble:note'")
    sessionTags: string = "skywriterble"

    @input
    @hint("Optional timezone string for the heading and :TZ: property. If empty, the device's UTC offset is used (e.g., '+0900'). Set to override (e.g., 'JST', 'America/Los_Angeles').")
    timezone: string = ""

    @input
    @hint("If on, attempts to read GPS lat/lng on lens open and writes a :LATLNG: property into the session heading. Requires Spectacles location permission + Snapchat pairing.")
    includeLocation: boolean = false

    @input
    @hint("Max seconds to wait for a location result before writing the heading without coords (it'll be filled in later if/when GPS resolves).")
    locationTimeoutSec: number = 3.0

    @input
    @allowUndefined
    @hint("Optional UIKit button (e.g., SphereButton) that triggers clearBuffer() on tap. Wires to the button's onTriggerUp event. WARNING: clearing the buffer is destructive and has no undo — wire a deliberate / hard-to-tap button.")
    clearButton: any

    private store: JournalStore
    private buffer: string = ""
    private autosaveEvent: DelayedCallbackEvent
    private dirty: boolean = false
    private locationService: any = null
    private pendingLocationToken: string | null = null

    private onBufferChangedEvent = new Event<string>()
    public onBufferChanged = this.onBufferChangedEvent.publicApi()

    onAwake() {
        this.store = new LocalJournalStore()
        this.createEvent("OnStartEvent").bind(() => this.init())
        this.createEvent("OnDestroyEvent").bind(() => this.flushNow())
    }

    private init() {
        this.autosaveEvent = this.createEvent("DelayedCallbackEvent")
        this.autosaveEvent.bind(() => this.flushNow())

        if (this.bleKeyboard && this.bleKeyboard.onKeypress) {
            this.bleKeyboard.onKeypress.add(this.onKeypress.bind(this))
        } else {
            print("JournalController: bleKeyboard not wired; keypresses will be ignored.")
        }

        if (this.clearButton && this.clearButton.onTriggerUp && this.clearButton.onTriggerUp.add) {
            this.clearButton.onTriggerUp.add(() => {
                print("JournalController: clearBuffer triggered by button")
                this.clearBuffer()
            })
        }

        // Defer the first render by one frame so SIK/UIKit ScrollWindow
        // (which initializes on OnStartEvent) is fully constructed before
        // we call into editor.setContent.
        const initialOpen = this.createEvent("DelayedCallbackEvent")
        initialOpen.bind(() => this.openBuffer())
        initialOpen.reset(0.05)
    }

    private openBuffer(): void {
        const stored = this.store.load()
        this.buffer = stored
        this.appendSessionHeading()
        // Fresh / first-launch buffer: scroll to top so the heading is
        // fully visible (cursor lives at the end of it) and show the
        // typing hint. Otherwise we're resuming an existing journal —
        // scroll to bottom so the user picks up where they left off, and
        // skip the hint (they've already typed before).
        const isFresh = stored.length === 0
        const scrollTo: "top" | "bottom" = isFresh ? "top" : "bottom"
        if (this.editor) {
            this.editor.setHint(isFresh)
            this.editor.setContent(this.buffer, scrollTo, true)
        }
        this.markDirty()
        this.onBufferChangedEvent.invoke(this.buffer)

        if (this.includeLocation && this.pendingLocationToken) {
            this.startLocationFetch()
        }
    }

    private onKeypress(data: KeypressData) {
        const key = data.key

        if (key === "BACKSPACE") {
            if (this.buffer.length === 0) return
            this.buffer = this.buffer.slice(0, -1)
        } else if (key === "ESC") {
            return
        } else if (key.indexOf("[0x") === 0) {
            return
        } else {
            this.buffer += key
        }

        if (this.editor) {
            // Hide the "start typing" hint as soon as the user types anything;
            // setContent then renders content + cursor without the hint.
            this.editor.setHint(false)
            this.editor.setContent(this.buffer)
        }
        this.markDirty()
    }

    /**
     * Wipe the persisted buffer entirely and start fresh with just a new
     * session heading. Use sparingly — there's no undo.
     */
    public clearBuffer(): void {
        this.dirty = false
        this.buffer = ""
        this.store.clear()
        this.appendSessionHeading()
        // Buffer now contains only the fresh session heading — scroll to
        // top so the user sees the heading + cursor instead of landing
        // at the bottom of a near-empty viewport. resetSize=true so the
        // scroll layer shrinks back to fit the small new content. Re-show
        // the typing hint since this is a fresh session.
        if (this.editor) {
            this.editor.setHint(true)
            this.editor.setContent(this.buffer, "top", true)
        }
        this.markDirty()
        this.onBufferChangedEvent.invoke(this.buffer)
    }

    public getBuffer(): string {
        return this.buffer
    }

    private appendSessionHeading(): void {
        const heading = this.buildSessionHeading()
        if (this.buffer.length === 0) {
            this.buffer = heading
            return
        }
        // Ensure exactly one blank line separates the previous content from
        // the new heading so the org structure stays clean.
        if (this.buffer.endsWith("\n\n")) {
            this.buffer += heading
        } else if (this.buffer.endsWith("\n")) {
            this.buffer += "\n" + heading
        } else {
            this.buffer += "\n\n" + heading
        }
    }

    private buildSessionHeading(): string {
        const tz = this.effectiveTimezone()
        const ts = this.formatOrgTimestamp(Date.now(), tz)
        const tags = this.sessionTags ? " :" + this.sessionTags + ":" : ""
        const lines: string[] = []
        lines.push("* " + this.sessionHeading + tags)
        lines.push("  " + ts)
        lines.push("  :PROPERTIES:")
        lines.push("  :TZ: " + tz)
        lines.push("  :DEVICE: spectacles")
        if (this.includeLocation) {
            // Token gets replaced by replacePendingLocationToken() once the
            // location service callback fires. If it never fires (timeout,
            // permission denied), the token stays in the buffer as a marker
            // — easy to grep for.
            this.pendingLocationToken = "<<latlng-" + Date.now() + ">>"
            lines.push("  :LATLNG: " + this.pendingLocationToken)
        }
        lines.push("  :END:")
        lines.push("")  // blank line, free text follows
        return lines.join("\n")
    }

    /**
     * Org-mode inactive timestamp: [YYYY-MM-DD Day HH:MM TZ]
     * Example: [2026-04-26 Sun 14:32 +0900]
     */
    private formatOrgTimestamp(ms: number, tz: string): string {
        const d = new Date(ms)
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        const pad = (n: number) => (n < 10 ? "0" + n : "" + n)
        const date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
        const day = dayNames[d.getDay()]
        const time = pad(d.getHours()) + ":" + pad(d.getMinutes())
        const tzPart = tz ? " " + tz : ""
        return "[" + date + " " + day + " " + time + tzPart + "]"
    }

    /**
     * Returns the configured `timezone` if set, otherwise the device's UTC
     * offset in `+HHMM` / `-HHMM` form derived from `Date.getTimezoneOffset()`.
     */
    private effectiveTimezone(): string {
        if (this.timezone && this.timezone.length > 0) return this.timezone
        const offsetMin = -new Date().getTimezoneOffset()  // east-of-UTC, positive
        const sign = offsetMin >= 0 ? "+" : "-"
        const abs = Math.abs(offsetMin)
        const hh = Math.floor(abs / 60)
        const mm = abs % 60
        const pad = (n: number) => (n < 10 ? "0" + n : "" + n)
        return sign + pad(hh) + pad(mm)
    }

    /**
     * Kicks off an async location lookup and a parallel timeout. Whichever
     * fires first wins; the loser is a no-op. On success, replaces the
     * heading's <<latlng-...>> token with the real coords.
     */
    private startLocationFetch(): void {
        const token = this.pendingLocationToken
        if (!token) return

        let resolved = false
        const finish = (replacement: string) => {
            if (resolved) return
            resolved = true
            this.replacePendingLocationToken(token, replacement)
            this.pendingLocationToken = null
        }

        const timeout = this.createEvent("DelayedCallbackEvent")
        timeout.bind(() => finish("unavailable"))
        timeout.reset(Math.max(0.5, this.locationTimeoutSec))

        try {
            if (!this.locationService) {
                this.locationService = GeoLocation.createLocationService()
            }
            this.locationService.getCurrentPosition(
                (pos: GeoPosition) => {
                    const latlng = pos.latitude.toFixed(6) + "," + pos.longitude.toFixed(6)
                    finish(latlng)
                },
                (err: string) => {
                    print("JournalController: location error: " + err)
                    finish("unavailable")
                }
            )
        } catch (e) {
            print("JournalController: location service unavailable: " + e)
            finish("unavailable")
        }
    }

    private replacePendingLocationToken(token: string, replacement: string): void {
        const idx = this.buffer.lastIndexOf(token)
        if (idx < 0) return
        this.buffer = this.buffer.slice(0, idx) + replacement + this.buffer.slice(idx + token.length)
        if (this.editor) this.editor.setContent(this.buffer)
        this.markDirty()
    }

    private markDirty(): void {
        this.dirty = true
        if (this.autosaveEvent) {
            this.autosaveEvent.reset(this.autosaveDelay)
        }
    }

    private flushNow(): void {
        if (!this.dirty) return
        this.store.save(this.buffer)
        this.dirty = false
    }
}
