# From design to code

Use this when the user wants code from a suikopen design, typically from a coding agent working in their project.

1. Read the target: screenshot it, then export_code on it (format "html-tailwind" for Tailwind projects, "html-css" otherwise). The screenshot is the visual target; the export carries the exact structure, sizes, colours and copy. Use get_node for anything the export leaves unclear.
2. Read the tokens: get_variables. Map each var(--name) in the export to the project's existing tokens (CSS variables, Tailwind theme, design tokens), adding missing ones from the returned css. Do not hardcode hex values that already exist as tokens.
3. Inspect the project first: framework, styling approach (Tailwind, CSS modules, styled-components), installed versions, and existing components. Reuse an existing component when it matches; extend it only when it cannot express the design.
4. The export is a faithful but static starting point, not final code. Translate layout, not coordinates:
   - frame layout "vertical" / "horizontal" -> flex column / row; gap -> gap; padding -> padding.
   - justifyContent and alignItems map to the same flex properties (space_between -> space-between).
   - "fill_container" -> flex-1 on the main axis or stretch / w-full on the cross axis; "fit_content" -> auto size; numbers -> fixed size only when the design truly needs it.
   - layout "none" children use absolute positioning only for overlays and decoration.
5. Components: each "ref" node is an instance of its masterId. Build the master once as a component with props for every override seen across instances, then use it at each instance.
6. Text: keep the exact copy, font family, size, weight, line height and letter spacing; load Google Fonts the way the project already loads fonts. Icons from api.iconify.design are named in their URL (for example lucide/bell): use the project's icon library component for that name (such as Bell from lucide-react) instead of the image. Other images and logos keep their source URLs or are downloaded into the project's assets.
7. Make it real: decide which parts are interactive (buttons, inputs, tabs, menus) and wire them as proper elements with hover, focus and disabled states and accessible labels.
8. Verify: render the result, compare against the screenshot, and fix spacing, colour and type differences before finishing. Do not write extra documentation files.
