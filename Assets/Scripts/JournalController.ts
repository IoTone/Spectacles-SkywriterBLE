// Copyright (c) 2026 IoTone, Inc. All rights reserved.
// Licensed under the MIT License. See LICENSE.md in the project root.

import {BleKeyboard, KeypressData} from "./BleKeyboard"
import Event from "./Event"
import {JournalEntry, JournalStore} from "./JournalTypes"
import {LocalJournalStore} from "./LocalJournalStore"
import {ScrollableTextEditor} from "./ScrollableTextEditor"

/**
 * JournalController — Owns the current journal entry, routes keypresses
 * into it, drives autosave, and is the source of truth that the editor
 * view and (future) entry picker UI both read from.
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

    private store: JournalStore
    private currentEntry: JournalEntry | null = null
    private autosaveEvent: DelayedCallbackEvent
    private dirty: boolean = false

    private onEntryChangedEvent = new Event<JournalEntry>()
    private onEntryListChangedEvent = new Event<JournalEntry[]>()

    public onEntryChanged = this.onEntryChangedEvent.publicApi()
    public onEntryListChanged = this.onEntryListChangedEvent.publicApi()

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

        // Defer the first entry render by one frame so SIK ScrollView
        // (which also initializes on OnStartEvent) is fully constructed
        // before we call into editor.setContent → recomputeBoundaries().
        const initialOpen = this.createEvent("DelayedCallbackEvent")
        initialOpen.bind(() => {
            const lastId = this.store.getCurrentId()
            const resumed = lastId ? this.store.load(lastId) : null
            if (resumed) {
                this.openEntry(resumed)
            } else {
                this.newEntry()
            }
        })
        initialOpen.reset(0.05)
    }

    private onKeypress(data: KeypressData) {
        if (!this.currentEntry) return
        const key = data.key

        print("buffer: '" + this.currentEntry.content + "'")
        if (key === "BACKSPACE") {
            if (this.currentEntry.content.length === 0) return
            this.currentEntry.content = this.currentEntry.content.slice(0, -1)
        } else if (key === "ESC") {
            return
        } else if (key.indexOf("[0x") === 0) {
            return
        } else {
            this.currentEntry.content += key
        }

        if (this.editor) this.editor.setContent(this.currentEntry.content)
        this.markDirty()
    }

    public newEntry(): JournalEntry {
        this.flushNow()

        const now = Date.now()
        const entry: JournalEntry = {
            id: String(now),
            createdAt: now,
            updatedAt: now,
            title: this.formatTimestamp(now),
            content: "",
        }
        this.store.save(entry)
        this.store.setCurrentId(entry.id)
        this.openEntry(entry)
        this.onEntryListChangedEvent.invoke(this.store.list())
        return entry
    }

    public deleteCurrent(): void {
        if (!this.currentEntry) return
        const id = this.currentEntry.id
        this.dirty = false
        this.store.remove(id)

        const list = this.store.list()
        if (list.length > 0) {
            const next = this.store.load(list[0].id)
            if (next) {
                this.openEntry(next)
                this.store.setCurrentId(next.id)
                this.onEntryListChangedEvent.invoke(this.store.list())
                return
            }
        }
        this.newEntry()
    }

    public switchTo(id: string): void {
        if (this.currentEntry && this.currentEntry.id === id) return
        this.flushNow()
        const entry = this.store.load(id)
        if (!entry) {
            print("JournalController: entry not found: " + id)
            return
        }
        this.openEntry(entry)
        this.store.setCurrentId(id)
    }

    public listEntries(): JournalEntry[] {
        return this.store.list()
    }

    public getCurrentEntry(): JournalEntry | null {
        return this.currentEntry
    }

    private openEntry(entry: JournalEntry): void {
        this.currentEntry = entry
        this.dirty = false
        if (this.editor) this.editor.setContent(entry.content)
        this.onEntryChangedEvent.invoke(entry)
    }

    private markDirty(): void {
        this.dirty = true
        if (this.autosaveEvent) {
            this.autosaveEvent.reset(this.autosaveDelay)
        }
    }

    private flushNow(): void {
        if (!this.dirty || !this.currentEntry) return
        this.currentEntry.updatedAt = Date.now()
        this.store.save(this.currentEntry)
        this.dirty = false
    }

    private formatTimestamp(ms: number): string {
        const d = new Date(ms)
        const pad = (n: number) => (n < 10 ? "0" + n : "" + n)
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
            + " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
    }
}
