# Large Document Walkthrough

Open this file directly to exercise the large-document navigation work. It is intentionally section-heavy, includes duplicate headings, and links into itself.

## Quick Jumps

- Jump to [Rendering Pipeline](#rendering-pipeline)
- Jump to [API Notes](#api-notes)
- Jump to the second [API Notes](#api-notes-2)
- Jump to [Operational Checklist](#operational-checklist)
- Open the smaller [Getting Started](./getting-started.md) example

## Overview

This viewer still reads a single rendered Markdown document. The large-file work adds anchors, an outline, and section tracking without introducing a separate reading mode.

## Reader Goals

- Keep the document readable.
- Make section jumps fast.
- Preserve the lightweight note-reader feel.

## Rendering Pipeline

The app renders Markdown in the main process, then swaps the HTML into the reader panel in the renderer. That means heading IDs need to be deterministic at render time so the renderer can rely on them later.

### Rendering Pipeline Details

Heading text becomes the source of the anchor ID. When two headings normalize to the same slug, the later one gets a numeric suffix.

### Rendering Pipeline Risks

- Duplicate headings create ambiguous anchors unless IDs are deduplicated.
- Long documents punish any feature that rebuilds the whole DOM on every interaction.

## Outline Expectations

An outline should stay compact, respect heading depth, and follow scroll state instead of fighting it.

### Section Depth

Nested headings should be visible without forcing a fully expanded tree control right away.

### Section Depth Notes

Even a flat indented outline is enough to make a long note meaningfully faster to scan.

## API Notes

This section name is reused later on purpose. The second copy should produce a different anchor and remain linkable.

### API Notes Details

Internal links that target the current file should scroll within the reader instead of falling back to browser behavior.

## Scroll Memory

Reopening a long note should put the reader close to where it was during the same session. That matters more once the note is long enough to need navigation aids.

### Scroll Memory Notes

Session-level restore is usually enough for a first pass. Persistent restore can come later if the behavior feels correct.

## API Notes

This is the duplicate heading. Its anchor should normalize to `#api-notes-2` rather than colliding with the earlier section.

### API Notes Tradeoffs

- Outline generation can be DOM-driven after render.
- Search should still target rendered text rather than raw Markdown source.

## Large-Doc Trigger

The current version uses a simple threshold based on character count or heading density. That keeps activation deterministic and cheap.

### Threshold Notes

The threshold does not need to be perfect yet. It only needs to turn on extra navigation before the document starts to feel awkward.

## Deep Links

Cross-file links such as `./other-note.md#section-name` should continue to work. Same-file links should also remain valid once heading IDs are stable.

### Deep Link Cases

- Same file with `#hash`
- Another Markdown file with `#hash`
- A duplicate heading that needs a suffixed anchor

## Operational Checklist

1. Verify the outline appears automatically.
2. Click a few items in the outline.
3. Use the links in the quick-jump list near the top.
4. Scroll into the middle of the file and reopen it from the sidebar.

### Follow-Up Work

Search is still the next major piece. Once that is in place, the outline and search together should cover most large-note navigation needs.
