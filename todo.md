# Large Document Navigation TODO

## Goal

Make long Markdown documents easier to navigate without changing the app's core reading model.

## Priority 1: In-Document Search

- Add `Cmd+F` / `Ctrl+F` support inside the rendered document.
- Highlight all matches in the current document.
- Jump between next/previous matches.
- Keep match count visible.
- Clear highlights cleanly when search is closed or text changes.

### Notes

- This should search rendered text, not raw markdown source.
- Avoid rebuilding the whole document on every keystroke.
- Preserve the user's scroll position as much as possible.

## Priority 2: Document Outline

- Extract headings from the rendered document or markdown source.
- Show a compact outline panel for `h1`-`h6`.
- Allow click-to-jump navigation to sections.
- Highlight the active section while scrolling.
- Support collapsed nested sections for long outlines.

### Notes

- Heading IDs must be stable and deterministic.
- Duplicate headings need unique anchor IDs.
- The outline should stay optional so the main layout remains simple for short notes.

## Priority 3: Better Large-Doc Mode

- Detect when a document crosses a "large document" threshold.
- Enable extra navigation affordances automatically for that mode.
- Consider showing:
  - outline panel
  - search bar
  - jump-to-top / jump-to-heading controls
  - current section indicator

### Notes

- Start with a simple threshold based on markdown size or heading count.
- Do not create a separate reading mode unless the normal layout cannot scale.

## Priority 4: Heading Anchors and Deep Links

- Ensure every heading gets a valid anchor target.
- Allow copying a deep link to the current section.
- Preserve in-document anchor navigation when links point to `#section-name`.

### Notes

- This work supports both the outline panel and search results.
- It also improves interoperability with markdown links written by users.

## Priority 5: Scroll and Location UX

- Keep the active heading in sync with scroll position.
- Restore prior scroll position when reopening a file.
- Optionally remember the last heading/position per document.

### Notes

- This becomes more valuable once search and outline navigation exist.
- Avoid overly aggressive auto-scrolling when the document is still rendering.

## Optional Later Work

- Section minimap or progress rail.
- Sticky section header while reading.
- Search within headings only.
- "Recent sections" history for quick backtracking.
- Progressive section rendering for very large documents.

## Recommended Build Order

1. Add stable heading anchors.
2. Build document outline.
3. Add in-document search with keyboard shortcut support.
4. Add active-section tracking on scroll.
5. Reassess whether progressive rendering is still worth doing.

## Success Criteria

- A user can open a long note and jump to the right section quickly.
- A user can search inside the current document without relying on browser-style fallback behavior.
- Navigation features improve long-document usability without making short documents feel heavier.
