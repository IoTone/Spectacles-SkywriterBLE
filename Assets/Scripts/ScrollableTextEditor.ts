// Copyright (c) 2026 IoTone, Inc. All rights reserved.
// Licensed under the MIT License. See LICENSE.md in the project root.

import {ScrollAdapter, createScrollAdapter} from "./ScrollAdapter"

/**
 * ScrollableTextEditor — A view component that renders text inside a
 * scrollable region (SIK ScrollView or SpectaclesUIKit ScrollWindow), with
 * a blinking cursor and auto-scroll.
 *
 * The scroll backend is selected automatically based on which input is
 * wired in the Inspector (see ScrollAdapter.ts). Wire `scrollWindow` for
 * the UIKit path, or `scrollView` + `scrollContentTransform` for the legacy
 * SIK path. Wire neither for a no-scroll fallback that just renders text.
 *
 * Source of truth lives in JournalController; this component only displays
 * whatever string it is told to display via setContent().
 *
 * Scene setup (UIKit, target):
 *   Frame
 *     -> ScrollWindow
 *         -> EditorText (Text component)
 *
 * Scene setup (SIK, legacy):
 *   ContainerFrame
 *     -> ScrollView
 *         -> ScrollContent (ScreenTransform)
 *             -> EditorText (Text component)
 */
@component
export class ScrollableTextEditor extends BaseScriptComponent {

    @input
    @hint("The Text component that displays typed content")
    editorText: Text

    @input
    @allowUndefined
    @hint("UIKit ScrollWindow component (preferred). Wire this OR the SIK pair below.")
    scrollWindow: any

    @input
    @allowUndefined
    @hint("LEGACY: SIK ScrollView component. Used only if scrollWindow is not wired.")
    scrollView: any

    @input
    @allowUndefined
    @hint("LEGACY: ScreenTransform of the SIK scroll content wrapper. Used only with scrollView.")
    scrollContentTransform: ScreenTransform

    @input
    @hint("Line height in local units for scroll calculation (SIK path only)")
    lineHeight: number = 1.5

    @input
    @hint("Max characters per line before wrapping")
    maxLineWidth: number = 45

    @input
    @hint("DEBUG: fill the editor with a checker grid so layout can be inspected in Preview without BLE. Ignores setContent() while on.")
    debugGrid: boolean = false

    @input
    @hint("DEBUG: characters per row in the grid")
    debugGridWidth: number = 50

    @input
    @hint("DEBUG: number of rows in the grid")
    debugGridRows: number = 40

    private content: string = ""
    private cursorVisible: boolean = true
    private cursorBlinkEvent: DelayedCallbackEvent
    private adapter: ScrollAdapter

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        this.adapter = createScrollAdapter({
            scrollWindow: this.scrollWindow,
            sikScrollView: this.scrollView,
            sikContentTransform: this.scrollContentTransform,
        })
        print("ScrollableTextEditor: scroll adapter = " + this.adapter.name)

        if (this.debugGrid) {
            this.content = this.buildDebugGrid()
            this.cursorVisible = false
            this.renderText()
            return
        }

        this.cursorBlinkEvent = this.createEvent("DelayedCallbackEvent")
        this.cursorBlinkEvent.bind(() => {
            this.cursorVisible = !this.cursorVisible
            this.renderText()
            this.cursorBlinkEvent.reset(0.5)
        })
        this.cursorBlinkEvent.reset(0.5)

        this.renderText()
    }

    public setContent(text: string): void {
        if (this.debugGrid) return
        this.content = text || ""
        this.cursorVisible = true
        this.renderText()
        if (this.adapter) this.adapter.scrollToBottom()
    }

    public getContent(): string {
        return this.content
    }

    private renderText() {
        if (!this.editorText) return

        const cursor = this.cursorVisible ? "|" : " "
        this.editorText.text = this.content + cursor

        if (this.adapter && !this.debugGrid) {
            this.adapter.setContentSize(this.getWrappedLineCount(), this.lineHeight)
        }
    }

    private getWrappedLineCount(): number {
        if (this.content.length === 0) return 1

        let count = 0
        const rawLines = this.content.split("\n")

        for (const rawLine of rawLines) {
            if (rawLine.length === 0) {
                count++
                continue
            }
            count += Math.ceil(rawLine.length / this.maxLineWidth)
        }

        return count
    }

    private buildDebugGrid(): string {
        const w = Math.max(10, Math.floor(this.debugGridWidth))
        const rows = Math.max(2, Math.floor(this.debugGridRows))

        const lines: string[] = []

        // Column tens-ruler: "0         1         2         3..."
        let tens = ""
        for (let i = 0; i < w; i++) {
            tens += (i % 10 === 0) ? String(Math.floor(i / 10) % 10) : " "
        }
        lines.push(tens)

        // Column ones-ruler: "0123456789012345..."
        let ones = ""
        for (let i = 0; i < w; i++) {
            ones += String(i % 10)
        }
        lines.push(ones)

        // Body: alternating checker rows, each prefixed with a 2-digit row number.
        // Uses ASCII chars (#, .) so layout math stays width-stable across fonts.
        for (let r = 1; r <= rows; r++) {
            const prefix = (r < 10 ? "0" + r : String(r)) + " "
            const innerW = Math.max(0, w - prefix.length)
            let row = ""
            const rowEven = (r % 2 === 0)
            for (let i = 0; i < innerW; i++) {
                const cellEven = (i % 2 === 0)
                row += (rowEven === cellEven) ? "#" : "."
            }
            lines.push(prefix + row)
        }

        return lines.join("\n")
    }
}
