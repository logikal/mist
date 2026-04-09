# Design System

Visual design principles and specifications for mist.

## Typography

- **Base font size:** 14px, set on the root `<html>` element.
- **Sans font:** System sans-serif (`ui-sans-serif, system-ui, sans-serif`).
- **Mono font:** IBM Plex Mono (`"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`).
- **Serif font:** Georgia / Times New Roman (used in preview mode).
- **Sizing:** Use the base size for most text. Step up to large for anything the user writes (editor content). Step down to small for secondary information inside pills or very secondary buttons.

## Colour Palette

- **Primary tones:** Black, white, off-white, and greys — slightly softened (not pure #000/#fff) to avoid harshness.
- **Accent: Coral red-pink** — used rarely, set up with wide gamut (`color(display-p3 ...)`) so it appears almost luminous on supported displays.
- **Accent: Chartreuse** — same wide gamut treatment. Also used rarely.
- **Accent: Canary** — bright yellow, wide gamut (`color(display-p3 1 0.9 0.04)`, sRGB fallback `#ffe014`). Used for comment/highlight decorations (thick underline, active background, point markers) and the "+ ADD" comment button. Always use dark text (`#1a1a1a`) on canary backgrounds.
- All accents should fall back gracefully to sRGB on non-wide-gamut displays.

## Layout

- **Minimum height:** 100vh (edge to edge vertically).
- **Dividers:** Thin horizontal lines beneath the header spanning the full viewport width. Columns are also divided by thin lines.
- **Two-column pages:** Left column is flexible (primary content). Right column is fixed-width (metadata/actions).
- **Mobile:** Below the median breakpoint, collapse to a single column. The right column content becomes a second full-width row beneath a dividing line, navigable via tabs.
- **No footer** on document pages (documents can extend very long). The homepage may use elements anchored to the bottom.

## Visual Principles

- Almost no border radius.
- No drop shadows.
- No cards. This is a web app, not a native app — the aesthetic is typographic and flat.
- Avoid sticky positioning as much as possible.
- Use Tailwind CSS for all styling.

## Component Notes

- **Connection status indicator:** Small coloured dot with uppercase status text. Positioned top-right of the header.
- **Share button:** Button with dropdown. Main action copies URL to clipboard (shows a tick on success). Dropdown includes disabled "Share read-only" and "Private" options (future features).
- **Preview area:** Large tap target in the bottom-right area. Click/tap toggles markdown preview. Press P (when not focused on editor) to show preview while held. Hover for 0.5s also triggers preview. Preview renders the markdown with serif fonts.
