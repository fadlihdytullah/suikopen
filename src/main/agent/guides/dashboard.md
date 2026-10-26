# Dashboards and tables

Frame: width 1440, height "fit_content(900)". Usually a sidebar + content shell (see the web-app guide).

Dashboards:
- Lead with the three to five numbers that matter most as stat blocks in one horizontal row with fill_container children: label (13, muted), value (28-32, semibold), change (13, green or red with a sign).
- Then one primary chart that answers the main question, then supporting tables or lists. Do not give every widget equal weight.
- Group by question, not by data source. Each panel gets a title that says what it shows.
- Bar charts: a horizontal frame with alignItems "end" and gap, each bar a rectangle with a numeric height inside a vertical frame with its label below. Line charts cannot be built precisely; prefer bars or a simple sparkline image.

Tables:
- Structure is always Table (vertical) > Row (horizontal, width fill_container, fixed height 44-56) > Cell (frame, fixed or fill_container width) > content. Never put text directly in a row.
- Header row: muted 12-13 semibold text, a bottom hairline stroke.
- Give columns the same width in every row so they line up. Numbers right-aligned, text left-aligned.
- Status as small badges, actions as a trailing icon button or overflow menu.
- Include realistic sample data for 6-10 rows, plus a footer with pagination or a count.
- On mobile, turn wide tables into stacked cards.
