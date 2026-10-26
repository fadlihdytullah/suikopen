# Mobile app screens

Frame: width 390, height "fit_content(844)", layout "vertical", gap 0. Let the height grow with content; do not force the device height.

Build order: status bar, then the bottom tab bar (if the app has top-level destinations), then the content between them.

- Status bar: height 54, horizontal, space_between, padding [0, 24], time on the left and small signal/battery images on the right. Never put app UI behind it.
- Header: large title (28-34, bold) or a centred nav title (17, semibold) with back and action buttons at 44x44.
- Content: one wrapper frame, width "fill_container", padding [8, 20], gap 24 between sections and 12 between related items. Apply side padding once on the wrapper, not on each section.
- Tab bar: last child of the screen, never absolutely positioned. 3-5 items, each an icon (24) above a label (10-11). The active item uses the accent colour; the rest are muted. Add bottom padding 24-34 for the home indicator.

Rules:
- One primary purpose per screen. The first thing on screen says where the user is and what they can do.
- Touch targets at least 44x44. Primary actions within thumb reach in the lower half, often a full-width button above the tab bar.
- Use the same title size on every screen of the app.
- Lists: rows of 56-72 height with a leading image or icon, title, muted subtitle and trailing chevron or value; separate with spacing or hairline strokes, not boxes around each row.
- Several screens of one flow sit side by side with 80 between them, named "<Flow> / <Step>".
