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

## Shared browser surface

- When browser mode is active, place one quiet monitor control with the other top-of-chat actions. A model handoff opens the same surface automatically so the user never has to hunt for it.
- Keep desktop chat and browser as peers in a split layout. On narrow screens, let the browser become a dismissible full-screen surface instead of squeezing either pane or introducing horizontal scrolling.
- The browser frame represents the exact Chromium page shared with the model. Preserve aspect ratio, map pointer and wheel coordinates back to the fixed browser viewport, and keep navigation and focused-field text entry immediately adjacent to the frame.
- Put a horizontally scrollable tab strip above navigation. Titles come from pages, while model-assigned labels lead and notes remain available as concise tab context. New-tab availability must visibly follow the administrator's session limit.
- Human and model controls operate on the same active tab. The model can list, label, note, open, switch, and close tabs by stable per-session identifiers; closing the last tab ends that browser session.
- Browser tabs belong to the conversation rather than one assistant response. Keep them available across completed responses and periods of inactivity; only an explicit user/model close, last-tab close, or conversation deletion ends the session. Capacity limits reject new sessions instead of evicting existing work.
- Human handoff is explicit: state why the model is waiting and provide one completion action. Closing the visual panel does not claim the task is complete or discard the shared session.
- Browser frames and controls are authenticated conversation surfaces, not public media endpoints. Keep ownership checks and public-network navigation policy active for every operation.
- Bound model-facing page snapshots by both body length and final serialized size; labels and links must not bypass the page-text limit.
- A full-page screenshot is a context-safe observation, not an unlimited bitmap. Cap its captured height, disclose truncation, estimate multimodal tokens conservatively, and let the model scroll for later sections.

## Selectable questions

- Present model questions above the composer rather than inside the technical tool disclosure.
- Show one question at a time and use a short horizontal slide transition between questions.
- Let the model choose single selection, multiple selection, or ranked selection according to the question.
- Render submitted question-and-answer pairs as right-aligned user message bubbles before the model continues.
- Align submitted question-and-answer bubbles to the same right edge as ordinary user messages, even though they belong to the assistant transcript in storage.
- Keep the regular message composer visually secondary and unavailable while an answer is required.
- Keep generation cancellation available while a question is waiting; restore ordinary input when the task stops or is no longer available.
- Use motion only for active status indicators; completed and failed states must remain legible without animation.

## Harness and history

- Keep tool limits under Harness settings alongside context handling and title generation. Show advanced controls only when their mode is active.
- Give every settings panel the shared section heading: one icon, one title, one description. Harness panels are no exception.
- Present a small set of exclusive modes as radio cards with an icon, a short name and one explanatory line, not as a bare dropdown.
- Gather the controls that depend on a mode or switch inside one quiet bordered block under the choice that reveals them.
- Break long numeric limit lists into labelled groups of related fields so each group reads as a short topic.
- Put browser-tab and selectable-question caps in an Interactive tools group; schema validation and generated tool schemas must use the same saved limits.
- Show a bounded percentage as a slider with its current value beside it.
- Edit long harness prompts in a large separate modal; nested dialogs suspend the parent focus trap.
- Search original history in a dedicated modal, show branch matches with snippets, and open the selected branch directly.
- Give the sidebar a compact header holding the wordmark and a single icon control: collapse on desktop, close on mobile.
- Keep per-conversation rename and delete actions in one hover-revealed action group on the same row as the title; coarse pointers show them permanently.
- Desktop collapsed navigation retains only expand, new chat, search and profile controls, centred in the narrow rail. Mobile navigation retains its existing full drawer.
- The rail carries no wordmark. Its header holds one icon control: collapse on desktop, close in the mobile drawer.
- Collapsing animates the rail's width with the shared spring. Fade labels out and collapse their width together so nothing overflows the narrow rail mid-transition.

## Storage and user administration

- Put Storage manager immediately below Search in the expanded sidebar and retain it as an icon action in the collapsed rail. Storage is personal: every preview, download, list, and deletion request must enforce the signed-in owner on the server.
- Display screenshots and large chat images through authenticated file URLs. Never persist base64 image strings in messages or tool results when an owned file can represent the same media.
- Show used versus allocated capacity together, with a proportional meter and clear units. Files referenced by saved chats stay visibly protected from deletion.
- Keep the overall user list compact: identity, role, used/allocated storage, and one Manage action. Detailed role, quota, chat-history export, media browsing, and deletion controls belong in a dedicated user modal.
- The user-management overview shows aggregate used and aggregate allocated storage separately, plus the default quota for accounts created later. Quota inputs accept MB or GB without exposing raw byte counts.
- Treat administrator chat/media access as an audit workflow: preserve every branch in exports, package multi-item downloads as ZIP files, and log inspection and export actions server-side without adding an in-product notice to the managed account.

## Composer

- The composer is one pill row holding the add menu, the draft, the context meter, the reasoning picker and send.
- When the draft no longer fits beside those controls, the composer stretches into a large rounded rectangle: the text takes the first row and the controls drop below it.
- Decide the layout by measuring the draft against the space left over by the controls, whose widths are identical in both layouts, so the two states cannot oscillate.
- Stack the composer as soon as the leftover space is too narrow to type in, not only when the draft overflows it. On a phone that means the stacked layout from the start.
- Centre single-line rows. A row taller than its content must centre it; reserve top alignment for options that genuinely have several lines, where the marker belongs beside the first one.

## Product mark and greetings

- One drawn mark stands for a model: a 2-3-2 node-and-edge network in `currentColor`, used in the model settings lists, settings sidebar and favicon. The chat model dropdown omits model icons and centres its selection check vertically.
- Space the mark's layers so the network reads as layers rather than a cluster of touching circles: small nodes, wide gaps, and edges trimmed short of each node so the mark needs no plate behind it.
- The idle greeting varies by time of day across seven bands with several lines each. Pick randomly on each main-screen entry, excluding the previous visible line, and hold it still while typing. Appearance settings provides expandable time bands with five editable lines per language.
- Headings that carry Korean use `word-break: keep-all`; breaking between syllables reads as a typo.
- On narrow screens the greeting wraps inside 70% of the viewport rather than the full width.

## Gestures and scrolling

- The shell owns its scrolling, so `html` and `body` set `overscroll-behavior: none` and every inner scroller sets `contain`. A downward drag inside the app must never become a browser refresh.
- A popover anchored to an edge must cap its height against the viewport and scroll inside itself; a long list of choices cannot be allowed to run off screen.
- Streaming reasoning and the full transcript follow new content only while the reader stays near the bottom. Moving away pauses that one scroller and reveals a compact down-arrow action that returns to the latest content and resumes following.

## Temporary chats

- A temporary chat stays out of history and search, and is discarded when the user opens another chat, starts a new one, or reloads onto a different route. It exists server-side only because the streaming pipeline needs somewhere to write.
- Never sweep a temporary chat that still has a live chat job; another tab may be streaming into it.
- Promoting one clears the flag and titles it from the first exchange through the same harness settings the automatic path uses.

## Assistant transcript

- An assistant turn is a sequence, not a set of sections. Reasoning, delivered text, tool rounds and context compaction render in the order they happened, so text after a tool round sits after that round rather than above it.
- Each stage owns its own fold and its own duration. Several reasoning blocks in one answer are normal.
- Consecutive reasoning/tool folds use a compact gap. Keep a slightly larger, but still compact, gap where delivered prose meets a technical fold so the content boundary remains legible.
- `content` and `reasoning` stay the concatenation of every stage, so copying, export and upstream history never depend on the transcript.
- Context compaction is a stage of the answer, not a status line. It folds like a reasoning block and holds up to two panes: the compaction model's own reasoning and the summary that was kept. Never report it twice — while a stage is showing, the wait line stays quiet.
- After a tool result, project context from the last authoritative server measurement plus every newly appended message. Tool-round compaction must retain the newest assistant tool request and its observation; a provider-reported context overflow gets one bounded compaction retry and then a concrete, stable error.
- While compaction is active, keep its fold open and stream both the compaction model's reasoning and partial summary into their final panes.
- Messages written before the transcript existed carry no stages; reconstruct their fixed layout rather than dropping their content.

## Context compaction

- Decide on the largest available reading of what the next request costs, never the smaller. A structural estimate can sit far below what a tokenizer charges, and the interface shows the measured figure — compaction has to fire when *that* number crosses the threshold.
- A measurement describes the message set that produced it. Discard it the moment compaction replaces that set, or the next decision is made on a number that no longer applies.
- Check the threshold both before sending and while streaming. Mid-response, stop the output, compact, and resume with the summary plus the original request.

## Capability disclosure

- Never report a missing capability in the middle of a running response. A wait line states what is happening, not what the server cannot do.
- Where a choice determines what works, put the answer on the choice: an info marker on each option, revealing a table of supported, limited and unsupported features with the caveat behind every limited answer spelled out.
- A tooltip inside a scrolling popover must be portalled out of it and positioned against the viewport, flipping above its marker when below would overflow. Pair it with a visually hidden summary so the same facts reach assistive technology.

## Settings dialogs

- The footer offers a save only while the draft differs from the saved configuration. With nothing changed, disable the save and label the other button Close rather than Cancel — there is nothing to cancel.
- Never cap a model's output with a hidden constant. Give the limit a setting whose zero means "use whatever the context window leaves".

## Experimental features

- Unfinished capabilities live behind an administrator switch in their own settings tab, listed after the harness tab.
- While a feature is off, hide its control in the chat menus and refuse it on the server as well; a client must not be able to ask for it.
- The host-computer experiment is visible and usable only to Superadmin accounts and only on a non-containerized server. One feature switch exposes one chat tool.
- Host actions that are not trusted by the harness appear in a single approval card above the composer. Always show the numeric risk, concrete interpretation, full arguments, and Allow / Deny / Deny and redirect choices before execution.
- Partial trust opens a dedicated permission-matrix modal instead of reducing every action to five global risk switches. Give every file operation its own row, split overwrite and recursive-delete variants, separate process/upload/screen operations, and expose PowerShell and Bash risk levels independently. Each row chooses exactly one of automatic approval or confirmation; full trust never interrupts, and no trust interrupts every action.

## Host progress and command safety (3.0 beta 1)

- PowerShell and Bash commands are assessed in an isolated model request containing no chat history. Keep `prompt_processing` percentage visible until the server has crossed the real response-timeout threshold.
- A shell assessment speaks the user's interface language and names actual paths, programs, destinations, and side effects. Unknown, obfuscated, or failed assessments are risk level 5.

## Appearance choices

- Accent palettes are named swatches plus one custom colour. The settings panel previews the chosen accent live and restores the saved one if the panel is dismissed.
- Streaming has two independent presentation choices: whether newly settled text fades in, and whether bursts of tokens are released immediately or spread evenly.
- Presentation preferences never change what is sent to a model, and never alter stored conversation content.

## Progress and context (2.1.1)

- Keep progress on the existing quiet status line: neutral 16px donut and tabular grey percentage, configurable under Appearance.
- Never invent a completion percentage from elapsed time or token usage. Unavailable progress keeps the waiting indicator with a short unsupported label.
- Context disclosure shows input, response and reasoning in aligned white/grey rows. Identify history/draft values as estimates and recalculate immediately when prior reasoning is toggled.
- Give tool calls/results their own context-disclosure row. As soon as active compaction opens, replace every covered response/reasoning/tool estimate with the partial summary estimate rather than waiting for generation to finish.

- Context compaction places compact/resume prompt editors side by side on desktop and vertically on mobile. Show template placeholders and the per-response resume cap alongside the threshold. Keep compaction activity on the existing wait line.

## 2.1.5 refinements

- Temporary chat backgrounds use neutral grey without recolouring interactive accents. The idle heading is “안녕하세요, 여행자” and subtitle “채팅이 저장되지 않습니다”; omit the separate explanation above it.
- An empty temporary chat offers an icon-only Return to regular chat control (with title and accessible name), preserving its draft; a started temporary chat offers Save this chat.
- Display name belongs in its own account settings group with the same border, padding and input alignment as the password group.

## 2.1.6 activity display

- Use the simple Lightbulb icon for reasoning everywhere, including settings and the composer.
- Reasoning headings align with tool headings, have no left rule or indentation, and use a right chevron when collapsed and down when expanded.
- Once a chat has messages, place an icon-only activity visibility toggle to the right of its temporary-chat control. Hide technical records without discarding data or disclosure state; keep user question/answer bubbles visible.

## 2.1.7 setting reach

- Accent choosers are one component. Personal accent and the administrator-only sign-in accent use the same swatch row, custom entry and hex field, and each labels its swatches with its own heading so the two rows stay distinguishable.
- Only the personal accent previews live while settings are open. The sign-in accent belongs to a screen that is not on show, so leave the surrounding interface alone.
- Where a person can pin a default, an administrator gets one extra action beside it that reaches every account. Keep the personal action first and the wider one second, and let the personal action's active state be the receipt.
- A setting an account may not change is shown, disabled, with one line saying who owns it and what to do instead. Do not hide the control.
