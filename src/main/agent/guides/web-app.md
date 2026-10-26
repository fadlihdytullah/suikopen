# Web app screens

Frame: width 1440, height "fit_content(900)", layout "horizontal" or "vertical" depending on the shell.

Shape the screen around one job:
- Decide the one question this screen answers and the one primary action. Everything else is secondary and visibly quieter.
- Give the screen one dominant region (the list, the editor, the chart). Side panels and toolbars support it and take less weight.
- Pick a density and keep it: compact for data-heavy tools, comfortable for everyday apps, airy for simple flows.
- Only add a sidebar, table or dashboard grid when the job needs it. Infer the shell from the product, not from habit.

Shell patterns:
- Sidebar + content: sidebar width 240-280, vertical, padding 16, nav items as fit_content rows with an icon and a label; content area width "fill_container" with padding 32 and gap 24.
- Top bar + content: bar height 56-64, horizontal, space_between, padding [0, 24]; content centred with a max width of 1120-1200.
- Page header: title (24-28), one-line description, actions right-aligned (primary last).

States: for every data-driven area, show or at least plan the empty, loading and error states. When asked for "all states", lay them out as extra frames next to the main screen, named "<Screen> / Empty" and so on.

Actions: one primary button per view, secondary as outline or ghost, destructive in red and never next to the primary without spacing. Rare actions go in an overflow menu.

Entities (a user, an order, a file): name prominent, status as a small badge, key metadata in muted text, actions obvious.

Text: body 14-15, labels 12-13, never below 12. Tables and forms align to one left edge.
