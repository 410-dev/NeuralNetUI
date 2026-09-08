# NeuralNetUI Design Language

## 2.0 form language

- Every button, input and dropdown trigger is a full pill. Multi-line fields and containers use the large corner tokens instead; nothing in the interface reads as a square.
- Corner radii come from the `--radius-*` tokens. Raise the tokens rather than hand-tuning individual rules.
- Surfaces and type are hue-free: white and grey only. Colour belongs to the accent, which marks interactive and selected states, and to the danger and success signals.
- The accent is a per-user choice. Never hardcode an accent hue; build translucent accents from `rgb(var(--accent-rgb) / a)` so a palette change reaches every rule.
- Icons are drawn marks, not badges: white strokes, no plate, no tinted container. Icon-only buttons signal hover with colour and a slight scale, never a filled background.
- Native `select` elements cannot carry the pill shape or the popover animation, so the single `SelectMenu` component serves every choice in the app.
- Popovers animate both ways. Keep them mounted through the exit keyframes with `usePopoverPresence` and anchor the transform origin to the edge they grow from.
- Motion is elastic: share the `--spring` easing for shape, width and scale changes so the interface feels physical rather than linear.
- Reset a control's background explicitly. A styled `button` that leaves `background` unset shows the browser's disabled plate.

## Principles

- Keep the chat itself visually dominant; controls should stay compact and quiet until needed.
- Use the dark neutral surface with restrained blue accents already established by the application.
- Reveal dense technical information progressively through clear, keyboard-accessible disclosure controls.
- Preserve readable vertical stacks on mobile and never require horizontal page scrolling.
- Keep settings categories in a horizontally scrollable tab row on narrow screens so every panel remains reachable without compressing its icon target.
- Group display-only preferences under Appearance; model identifiers and Markdown strikethrough are personal presentation choices.
- Present connections, models, and reasoning presets as reorderable selections with drag-and-drop plus adjacent up/down controls; the saved order must match the chat pickers.
- Limit drag initiation to dedicated handles whenever a reorderable item contains editable text or form controls.
- Keep long settings sidebars independently scrollable while the selected item's editor remains visible.
- Settings dialogs trap keyboard focus, make the background inert, close with Escape, and restore focus to the opener. Icon controls and switches have accessible names.

## Reasoning controls

- Generate built-in reasoning choices from model capabilities: Fast / Thinking for toggles, Fast plus advertised effort levels when supported; omit unsupported controls.
- Aliases display inherited capabilities as read-only. Custom templates retain prompt replacement, prepend, and append controls; their native selector offers only supported values.

## Residency and waiting

- Put the per-server resident-model limit and wait policy together in Connection settings; explain zero as unlimited.
- Show one localized, accessible status line in the assistant response area for session waiting, unloading, loading, server waiting, or response preparation. Preserve the stop action throughout waiting.
- Clear transient statuses when generation starts producing output or the job ends; never store them as conversation content.

## Tool activity

- Group all tool calls from one assistant message under one top-level disclosure with a wrench icon and aggregate state.
- Show every call as a subordinate disclosure with a tool-specific icon and localized active, completed, or error wording.
- Keep the top-level group collapsed by default. When the user opens it, keep the currently active call expanded and completed calls collapsed until requested.
- Match tool headings to the reasoning heading typography: unboxed icons, regular weight, and the same font sizing.
- Show localized tool-call markers only in the rendered reasoning view; never mix those markers into stored or upstream reasoning content.

## Selectable questions

- Present model questions above the composer rather than inside the technical tool disclosure.
- Show one question at a time and use a short horizontal slide transition between questions.
- Let the model choose single selection, multiple selection, or ranked selection according to the question.
- Render submitted question-and-answer pairs as right-aligned user message bubbles before the model continues.
- Keep the regular message composer visually secondary and unavailable while an answer is required.
- Keep generation cancellation available while a question is waiting; restore ordinary input when the task stops or is no longer available.
- Use motion only for active status indicators; completed and failed states must remain legible without animation.

## Harness and history

- Keep tool limits under Harness settings alongside context handling and title generation. Show advanced controls only when their mode is active.
- Give every settings panel the shared section heading: one icon, one title, one description. Harness panels are no exception.
- Present a small set of exclusive modes as radio cards with an icon, a short name and one explanatory line, not as a bare dropdown.
- Gather the controls that depend on a mode or switch inside one quiet bordered block under the choice that reveals them.
- Break long numeric limit lists into labelled groups of related fields so each group reads as a short topic.
- Show a bounded percentage as a slider with its current value beside it.
- Edit long harness prompts in a large separate modal; nested dialogs suspend the parent focus trap.
- Search original history in a dedicated modal, show branch matches with snippets, and open the selected branch directly.
- Give the sidebar a compact header holding the wordmark and a single icon control: collapse on desktop, close on mobile.
- Keep per-conversation rename and delete actions in one hover-revealed action group on the same row as the title; coarse pointers show them permanently.
- Desktop collapsed navigation retains only expand, new chat, search and profile controls, centred in the narrow rail. Mobile navigation retains its existing full drawer.
- The rail carries no wordmark. Its header holds one icon control: collapse on desktop, close in the mobile drawer.
- Collapsing animates the rail's width with the shared spring. Fade labels out and collapse their width together so nothing overflows the narrow rail mid-transition.

## Composer

- The composer is one pill row holding the add menu, the draft, the context meter, the reasoning picker and send.
- When the draft no longer fits beside those controls, the composer stretches into a large rounded rectangle: the text takes the first row and the controls drop below it.
- Decide the layout by measuring the draft against the space left over by the controls, whose widths are identical in both layouts, so the two states cannot oscillate.

## Appearance choices

- Accent palettes are named swatches plus one custom colour. The settings panel previews the chosen accent live and restores the saved one if the panel is dismissed.
- Streaming has two independent presentation choices: whether newly settled text fades in, and whether bursts of tokens are released immediately or spread evenly.
- Presentation preferences never change what is sent to a model, and never alter stored conversation content.
