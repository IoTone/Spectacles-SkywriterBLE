// Copyright (c) 2026 IoTone, Inc. All rights reserved.
// Licensed under the MIT License. See LICENSE.md in the project root.

/**
 * ScrollAdapter — abstraction over the underlying scroll component so
 * ScrollableTextEditor doesn't depend on a specific framework (SIK ScrollView
 * vs SpectaclesUIKit ScrollWindow). Pick an implementation by wiring the
 * matching input in the Inspector; the editor auto-detects which to use.
 *
 * Adding a new backend (e.g., a hand-rolled scroll widget) is a matter of
 * implementing this interface and adding a constructor case in
 * createScrollAdapter().
 */
export interface ScrollAdapter {
    /** Tell the scroll layer that content has grown to N lines of `lineHeight` units each. */
    setContentSize(lineCount: number, lineHeight: number): void

    /** Snap the viewport to the bottom of the content. */
    scrollToBottom(): void

    /** Tag for diagnostics. */
    readonly name: string
}

/**
 * Used when no scroll backend is wired. Editor still renders text into the
 * Text component; content just won't scroll if it overflows.
 */
export class NoScrollAdapter implements ScrollAdapter {
    public readonly name = "none"
    public setContentSize(_lineCount: number, _lineHeight: number): void {}
    public scrollToBottom(): void {}
}

/**
 * SIK ScrollView adapter (deprecated stack — kept for fallback).
 * SIK requires manual wrapper-anchor manipulation to express content size.
 */
export class SikScrollAdapter implements ScrollAdapter {
    public readonly name = "sik"

    constructor(
        private readonly scrollView: any,
        private readonly contentTransform: ScreenTransform | null
    ) {}

    public setContentSize(lineCount: number, lineHeight: number): void {
        if (!this.contentTransform) return

        const totalHeight = Math.max(lineCount + 1, 5) * lineHeight
        const anchors = this.contentTransform.anchors
        anchors.bottom = -totalHeight
        anchors.top = 0
        this.contentTransform.anchors = anchors

        if (this.scrollView && this.scrollView.recomputeBoundaries) {
            try {
                this.scrollView.recomputeBoundaries()
            } catch (e) {
                // ScrollView not yet ready (early-init race); safe to skip —
                // a later render will recompute.
            }
        }
    }

    public scrollToBottom(): void {
        if (!this.scrollView) return

        if (this.scrollView.snapToEdges) {
            try {
                this.scrollView.snapToEdges({top: false, bottom: true, left: false, right: false})
                return
            } catch (e) {
                // fall through to scrollBy
            }
        }
        if (this.scrollView.scrollBy) {
            try {
                this.scrollView.scrollBy(new vec2(0, -100))
            } catch (e) {
                // give up silently
            }
        }
    }
}

/**
 * SpectaclesUIKit ScrollWindow adapter.
 *
 * Verified against Packages/SpectaclesUIKit.lspkg/.../ScrollWindow.ts:
 *
 * - `scrollDimensions: vec2` — total scrollable area in local-space pixels;
 *   x is window width (we don't change it), y is total content height.
 * - `scrollPositionNormalized: vec2` — y axis ranges -1 (bottom) to 1 (top).
 *   To show the bottom of content, set y = -1.
 * - ScrollWindow re-parents children to an internal `scroller` SceneObject
 *   at runtime, so we do not need to manage a wrapper SceneObject ourselves.
 */
export class UikitScrollAdapter implements ScrollAdapter {
    public readonly name = "uikit"

    constructor(private readonly scrollWindow: any) {}

    public setContentSize(lineCount: number, lineHeight: number): void {
        const w = this.scrollWindow
        if (!w) return

        const totalHeight = Math.max(lineCount + 1, 5) * lineHeight

        // Preserve the configured x dimension; only update y for content height.
        try {
            const current = w.scrollDimensions
            if (current && typeof current.x === "number") {
                w.scrollDimensions = new vec2(current.x, totalHeight)
            }
        } catch (e) {
            // ScrollWindow not yet initialized; later renders will retry.
        }
    }

    public scrollToBottom(): void {
        const w = this.scrollWindow
        if (!w) return
        try {
            // y = -1 is the bottom edge per ScrollWindow's normalized coords.
            w.scrollPositionNormalized = new vec2(0, -1)
        } catch (e) {
            // ScrollWindow not yet initialized; the next setContent will retry.
        }
    }
}

/**
 * Factory: pick an adapter based on which Inspector inputs are wired.
 *
 * Priority: UIKit ScrollWindow > SIK ScrollView > no-scroll. If both UIKit
 * and SIK are wired, UIKit wins so a half-finished migration leaves the
 * UIKit path active without needing to physically unwire SIK.
 */
export function createScrollAdapter(args: {
    scrollWindow?: any | null
    sikScrollView?: any | null
    sikContentTransform?: ScreenTransform | null
}): ScrollAdapter {
    if (args.scrollWindow) {
        return new UikitScrollAdapter(args.scrollWindow)
    }
    if (args.sikScrollView) {
        return new SikScrollAdapter(args.sikScrollView, args.sikContentTransform || null)
    }
    return new NoScrollAdapter()
}
