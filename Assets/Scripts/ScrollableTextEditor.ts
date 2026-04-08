// Copyright (c) 2026 IoTone, Inc. All rights reserved.
// Licensed under the MIT License. See LICENSE.md in the project root.

import {BleKeyboard, KeypressData} from "./BleKeyboard"

/**
 * ScrollableTextEditor — A text editor widget that displays typed text
 * inside a SIK ScrollView within a ContainerFrame. Text scrolls down
 * endlessly as you type, like a real text editor.
 *
 * Scene setup:
 *   ContainerFrame (SceneObject with ContainerFrame component)
 *     -> ScrollContent (SceneObject with ScreenTransform — this is the ScrollView's single child)
 *         -> EditorText (SceneObject with Text component + ScreenTransform)
 *
 *   Add a ScrollView component to the same SceneObject as the ContainerFrame (or a child).
 *   Wire the inputs in the inspector.
 */
@component
export class ScrollableTextEditor extends BaseScriptComponent {

    @input
    bleKeyboard: BleKeyboard

    @input
    @hint("The Text component that displays typed content")
    editorText: Text

    @input
    @hint("The ScrollView component for scrolling")
    scrollView: any

    @input
    @hint("ScreenTransform of the scroll content wrapper (ScrollView's child)")
    scrollContentTransform: ScreenTransform

    @input
    @hint("Line height in local units for scroll calculation")
    lineHeight: number = 1.5;

    @input
    @hint("Max characters per line before wrapping")
    maxLineWidth: number = 45;

    private content: string = "";
    private cursorVisible: boolean = true;
    private cursorBlinkEvent: DelayedCallbackEvent;

    onAwake() {
        if (!this.bleKeyboard || !this.bleKeyboard.onKeypress) {
            this.createEvent("OnStartEvent").bind(() => {
                this.init();
            });
        } else {
            this.init();
        }
    }

    private init() {
        this.bleKeyboard.onKeypress.add(this.onKeypress.bind(this));
        this.bleKeyboard.onDeviceConnected.add(this.onConnected.bind(this));

        if (this.editorText) {
            this.editorText.text = "Waiting for keyboard...\n_";
        }

        // Blink cursor every 500ms
        this.cursorBlinkEvent = this.createEvent("DelayedCallbackEvent");
        this.cursorBlinkEvent.bind(() => {
            this.cursorVisible = !this.cursorVisible;
            this.renderText();
            this.cursorBlinkEvent.reset(0.5);
        });
        this.cursorBlinkEvent.reset(0.5);
    }

    private onConnected(name: string) {
        this.content = "";
        this.renderText();
        this.scrollToBottom();
    }

    private onKeypress(data: KeypressData) {
        const key = data.key;

        if (key === "BACKSPACE") {
            if (this.content.length > 0) {
                this.content = this.content.slice(0, -1);
            }
        } else if (key === "ESC") {
            // ignore
        } else if (key.startsWith("[0x")) {
            // unknown key, ignore
        } else {
            this.content += key;
        }

        this.cursorVisible = true;
        this.renderText();
        this.scrollToBottom();
    }

    private renderText() {
        if (!this.editorText) return;

        const cursor = this.cursorVisible ? "|" : " ";
        this.editorText.text = this.content + cursor;

        // Resize the scroll content to fit all lines
        this.updateScrollContentSize();
    }

    private updateScrollContentSize() {
        if (!this.scrollContentTransform) return;

        const lines = this.getWrappedLineCount();
        const totalHeight = Math.max(lines + 1, 5) * this.lineHeight;

        // Expand the content wrapper's anchors to accommodate all text
        const anchors = this.scrollContentTransform.anchors;
        anchors.bottom = -totalHeight;
        anchors.top = 0;
        this.scrollContentTransform.anchors = anchors;

        // Tell ScrollView to recalculate boundaries
        if (this.scrollView && this.scrollView.recomputeBoundaries) {
            this.scrollView.recomputeBoundaries();
        }
    }

    private scrollToBottom() {
        if (!this.scrollView) return;

        // Use scrollBy or snapToEdges to scroll to bottom
        if (this.scrollView.snapToEdges) {
            // Snap to bottom edge
            try {
                this.scrollView.snapToEdges({ top: false, bottom: true, left: false, right: false });
            } catch (e) {
                // Fallback: set content position directly
                this.scrollToBottomDirect();
            }
        } else {
            this.scrollToBottomDirect();
        }
    }

    private scrollToBottomDirect() {
        if (!this.scrollView) return;

        // Scroll by a large amount downward to ensure we're at the bottom
        try {
            if (this.scrollView.scrollBy) {
                this.scrollView.scrollBy(new vec2(0, -100));
            }
        } catch (e) {
            // ScrollView API not available in expected form
        }
    }

    private getWrappedLineCount(): number {
        if (this.content.length === 0) return 1;

        let count = 0;
        const rawLines = this.content.split("\n");

        for (const rawLine of rawLines) {
            if (rawLine.length === 0) {
                count++;
                continue;
            }
            count += Math.ceil(rawLine.length / this.maxLineWidth);
        }

        return count;
    }
}
