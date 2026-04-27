# SpectaclesUIKit ScrollWindow Migration Plan

Parallel design for swapping the editor's scrolling implementation from SIK
(`ContainerFrame` + `ScrollView`) to SpectaclesUIKit (`Frame` + `ScrollWindow`).
The SIK path is currently the active implementation. This document captures
the migration strategy so we can pivot quickly without re-deriving design
decisions.

---

## 1. Goal and Non-Goals

### Goal

Replace the deprecated SIK `ContainerFrame` + `ScrollView` stack with their
SpectaclesUIKit successors, keeping the journal application logic
(`JournalController`, `LocalJournalStore`, `JournalTypes`) and the editor's
public API (`ScrollableTextEditor.setContent` / `getContent`) unchanged.

### Non-Goals

- Persistence model — `LocalJournalStore` is independent of the UI stack.
- Keypress handling — `JournalController.onKeypress` doesn't touch any UI
  framework.
- Text rendering settings — the `Text` component's font, layout rect, and
  overflow rules carry over unchanged.
- Header / dropdown / icon buttons — those are a separate UX initiative
  (per DESIGN.md proposed minimal UI). They will be built on whichever
  scroll stack wins; the choice doesn't constrain that work.

---

## 2. Component Mapping

| SIK (current) | SpectaclesUIKit (target) | Notes |
|---|---|---|
| `ContainerFrame` | `Frame` | The floating-window-in-3D wrapper. Expected to expose a similar `innerSize` / border / billboarding model. |
| `ScrollView` | `ScrollWindow` | The scrollable region. Should not need a manually-created wrapper child — `ScrollWindow` is expected to handle content sizing internally. |
| `MaskingComponent` (auto) | (auto, internal) | Both stacks mask content to viewport bounds; we shouldn't have to touch this. |
| Hand-rolled `ScrollContent` wrapper | (likely unnecessary) | If `ScrollWindow` measures Text bounds directly, we drop the wrapper SceneObject entirely. |

**Open question:** verify whether `ScrollWindow` requires exactly-one-child
content (as SIK does) or can measure arbitrary descendants. If the former,
the wrapper stays; if the latter, the hierarchy simplifies by one layer.

---

## 3. What Changes

### 3.1 Scene Hierarchy (target)

Design-time:

```
ChatWindow                          [Frame component (SpectaclesUIKit)]
  ├─ SkywriterBLE                   (existing label, unchanged)
  ├─ JournalControllerScene         [JournalController script, unchanged]
  ├─ ScrollableTextEditor           [ScrollableTextEditor script, unchanged]
  └─ EditorScroll                   [ScrollWindow component]
      └─ KeyboardText               [Text component + ScreenTransform]
```

Note the absence of an explicit content-wrapper SceneObject. If
`ScrollWindow` requires one, add a `ScrollContent` SceneObject between
`EditorScroll` and `KeyboardText` matching the current SIK structure.

### 3.2 `ScrollableTextEditor.ts` Inputs

Current (SIK):

```typescript
@input scrollView: any                              // SIK ScrollView script
@input scrollContentTransform: ScreenTransform      // wrapper anchors target
```

Target (UIKit):

```typescript
@input scrollWindow: any                            // UIKit ScrollWindow script
// scrollContentTransform may be removed entirely if ScrollWindow auto-sizes
```

Both inputs are `any` already, so the script's type checking is unaffected.
What needs porting are the **method calls**:

| Current (SIK) | Target (UIKit) | If unavailable |
|---|---|---|
| `scrollView.recomputeBoundaries()` | `scrollWindow.invalidateLayout()` (or equivalent) | call nothing; rely on ScrollWindow's automatic measurement |
| `scrollView.snapToEdges({bottom: true})` | `scrollWindow.scrollToBottom()` (assumed) | fall back to `scrollBy` with a large offset |
| `scrollView.scrollBy(vec2)` | `scrollWindow.scrollBy(vec2)` (likely identical) | — |

The defensive `try/catch` wrappers in the current `scrollToBottom()` and
`updateScrollContentSize()` should stay; they cover early-init races for
either stack.

### 3.3 ContainerFrame Bounds Workaround Goes Away

In the SIK path we discovered (and documented in DESIGN.md §3) that
ContainerFrame leaves its inner Transform at scale `(1,1,1)` regardless of
`innerSize`, requiring ScrollView's Bounds to be set to roughly
`±innerSize/2` instead of the natural `±1`. SpectaclesUIKit's `Frame` is
expected to provide a proper screen-space content area to its children, so
**ScrollWindow's Bounds at `-1, 1, -1, 1` should fill the visible frame
natively** — no hand-tuning per `innerSize`.

If `Frame` exhibits the same gotcha, port the same `±innerSize/2` rule.

---

## 4. What Stays Unchanged

These files are framework-agnostic and require **zero changes** for the
migration:

| File | Why it survives |
|---|---|
| `Assets/Scripts/JournalController.ts` | Talks only to `BleKeyboard` events and `editor.setContent` |
| `Assets/Scripts/LocalJournalStore.ts` | Pure persistence layer over `PersistentStorageSystem` |
| `Assets/Scripts/JournalTypes.ts` | Type definitions only |
| `Assets/Scripts/Event.ts` | Generic pub/sub; no UI deps |
| `Assets/Scripts/BleKeyboard.ts` | BLE driver; no UI deps |
| `Assets/Scripts/InteractableProbe.ts` | Diagnostic; deletable post-migration |

The `ScrollableTextEditor.ts` view stays mostly the same — only the three
ScrollView-specific method calls change (see §3.2).

---

## 5. Migration Steps

Estimated effort: **~30 min** if SpectaclesUIKit's API matches the assumed
shape, **~2 hours** if there are surprises requiring local exploration.

### Pre-migration (already done)

- [x] Persistence layer working independently of scroll stack
- [x] `ScrollableTextEditor` already isolates view logic behind `setContent`
- [x] `debugGrid` mode in editor for layout validation without BLE
- [x] DESIGN.md documents SIK gotchas so we don't re-discover them

### Migration

1. **Drop SpectaclesUIKit package** into `Packages/` (single `.lspkg` file from
   Snap's distribution).
2. **Replace `ContainerFrame` on `ChatWindow`** with `Frame`. Set equivalent
   properties: `innerSize`, `border`, `useBillboarding`, `isContentInteractable`,
   etc. Property names may shift slightly between APIs — verify in Inspector.
3. **Replace `ScrollView` on `ScrollableView`** with `ScrollWindow`. Configure
   vertical-only scrolling, scroll inertia, scroll limit equivalents.
4. **Test `debugGrid` first** (toggle on the ScrollableTextEditor input). The
   grid should render full-size at proper scroll bounds. If it doesn't, fix
   the layout before going further — same diagnostic ladder as the SIK path
   (Bounds → wrapper sizing → Z-position).
5. **Scrub interaction** — confirm pinch+drag scrolls content. This is the
   primary motivation for the migration; if it doesn't work here either, the
   issue is upstream (e.g., scene-level interactor setup), not stack-specific.
6. **Re-enable `JournalController` script.** Type via BLE, confirm characters
   appear, confirm autosave fires.
7. **Update method calls in `ScrollableTextEditor`** if `ScrollWindow`'s API
   differs from the assumptions in §3.2. Names: search for `scrollView` in
   the file and rename + adjust calls.
8. **Update DESIGN.md §3** to reference the new components. Move the "SIK
   gotchas" section into a "Historical Notes" subsection or delete if no
   longer relevant.

### Post-migration

- [ ] Delete `InteractableProbe.ts` (and its scene wiring) once not needed.
- [ ] Remove `debugGrid` block from `ScrollableTextEditor.ts` if not useful
      for ongoing iteration. Keep if helpful for future layout debugging.
- [ ] Update `README.md` "Scripts" / "Future Plans" sections.

---

## 6. Risks and Open Questions

| Risk | Mitigation |
|---|---|
| **`ScrollWindow` has the same Interactable competition with `Frame`** that we hit with SIK | Test interaction *before* fully migrating — keep the SIK scene as a fallback during the test phase. |
| **`ScrollWindow` API method names differ from assumptions** (recomputeBoundaries, snapToEdges, etc.) | Inspect the package source under `Packages/SpectaclesUIKit.lspkg/` once added. Update the mapping table in §3.2 with verified names. |
| **`Frame` has different child positioning model** than `ContainerFrame` | Run the `debugGrid` test first; it isolates layout from interaction. |
| **SpectaclesUIKit version drift** — Snap may rev the API | Pin the package version in `Packages/`; don't auto-upgrade during this work. |

### Open questions to resolve when we start

- Does `ScrollWindow` require a single content child, or does it measure
  arbitrary descendants?
- Does `Frame` expose a content area as a true ScreenTransform (so child
  Bounds at `±1` fill), or does it have the SIK-style Transform-only inner?
- Is there a built-in scrollbar / overflow indicator widget? (Affects whether
  we still need to build a custom hint glyph per the original UX design.)
- Does `ScrollWindow` consume drag input cleanly when nested in a `Frame` with
  translation/scaling enabled, or is the manipulator-vs-content competition
  the same?

---

## 7. Decision Criteria — When to Pull the Trigger

Switch to this plan if **any** of these hold:

- After spending another hour on SIK ScrollView interaction, drag-to-scroll
  still doesn't work on Spectacles hardware.
- A SIK fix requires modifying the SIK package source (it's read-only and
  tying our scene to a forked SIK is not sustainable).
- A new requirement comes up (e.g., a scrollbar widget, a built-in hint
  glyph, multi-finger gesture support) that SpectaclesUIKit provides natively
  and SIK does not.

Stay on SIK if:

- The current SIK path works once one specific configuration is found, with
  no source mods required.
- SpectaclesUIKit turns out to have its own undocumented gotchas of similar
  magnitude — the cost of switching exceeds the cost of working around SIK.

---

## 8. Rollback Plan

If we migrate and SpectaclesUIKit turns out worse, rolling back is cheap:

1. Re-add SIK ContainerFrame + ScrollView components to the ChatWindow and
   ScrollableView SceneObjects (the SIK package is still in `Packages/`).
2. Restore the `±innerSize/2` Bounds on the ScrollView SceneObject.
3. Revert the three method-call changes in `ScrollableTextEditor.ts` from §3.2.

Application-layer code (`JournalController`, store, types) is untouched in
both directions — the rollback is purely a scene + view-layer revert.
