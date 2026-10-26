# Components and design systems

- Before building, look for existing components (find_nodes) and variables (get_variables). Reuse them; consistency beats invention.
- Put reusable masters in one top-level frame named "Components", above or left of the screens. Name masters by role and variant: "Button / Primary", "Button / Secondary", "Input / Default".
- Instance a master with a "ref" node (masterId) and change only what differs through overrides, keyed by the master-relative path such as "master/label".
- Make a component when the same structure appears three or more times (buttons, list rows, cards, nav items). Build the master first, then instance it.
- When the document has no variables yet and the user wants a system, define colours (background, surface, text, muted text, border, accent, accent text, danger), radii and spacing with set_variables first (get_style gives a good starting set), then use "$name" everywhere.
- Buttons: height 36-44, padding [0, 16], label 14 semibold, radius from the system. Primary filled with the accent, secondary outlined, ghost text-only.
- Inputs: label above (13), field height 40, 1px border, placeholder in muted text, helper or error text below.
- Show variants and states of a component side by side (default, hover, disabled, error) in the Components frame when asked for a component set.
