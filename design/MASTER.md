# NeuralNetUI Design Language

## Principles

- Keep the chat itself visually dominant; controls should stay compact and quiet until needed.
- Use the dark neutral surface with restrained blue accents already established by the application.
- Reveal dense technical information progressively through clear, keyboard-accessible disclosure controls.
- Preserve readable vertical stacks on mobile and never require horizontal page scrolling.

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
- Use motion only for active status indicators; completed and failed states must remain legible without animation.
