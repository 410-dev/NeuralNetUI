import { BASIC_CATALOG_ID, COMPONENTS, FUNCTIONS } from "./catalog.ts";

/**
 * What the model reads when the A2UI skill is on: the protocol in brief, the catalog generated from the same table
 * the validator uses, and one complete example. Kept compact: it is sent with every request while the skill is on.
 */
export function a2uiInstructions() {
  const components = Object.entries(COMPONENTS).map(([name, spec]) => `- ${name}: ${spec.summary}${spec.required.length ? ` Required: ${spec.required.join(", ")}.` : ""}`).join("\n");
  const functions = Object.entries(FUNCTIONS).map(([name, spec]) => `- ${name}(${Object.keys(spec.args).map(key => spec.required.includes(key) ? key : `${key}?`).join(", ")}) → ${spec.returns}: ${spec.summary}`).join("\n");
  return `# Skill: Generative UI (A2UI v1.0)

You can show the person interactive UI (cards, forms, lists, tabs, dialogs) with the \`render_ui\` tool instead of describing it in text. Use it when structure helps: forms to fill in, choices, dashboards, comparisons, step-by-step flows. Keep using normal text for plain answers.

## How it works
- \`render_ui\` takes \`messages\`: an array of A2UI v1.0 messages, each \`{"version": "1.0", "<kind>": {...}}\` with exactly one kind:
  - \`createSurface\`: {surfaceId, catalogId: "${BASIC_CATALOG_ID}", components: [...], dataModel: {...}, sendDataModel?: true}
  - \`updateComponents\`: {surfaceId, components: [...]} — replaces components with the same id, adds new ones.
  - \`updateDataModel\`: {surfaceId, path: "/json/pointer", value} — value null deletes.
  - \`deleteSurface\`: {surfaceId}
- Components are a FLAT list. Each has a unique \`id\` and \`component\` (type). Exactly one has id "root". Parents refer to children by id: \`child\` (one id) or \`children\` (array of ids, or a template \`{"componentId": "item", "path": "/items"}\` that repeats "item" for every array element; inside the template, relative paths like {"@path": "name"} read the element).
- Dynamic values: a literal, \`{"@path": "/abs/path"}\` (data binding) or \`{"@call": "fn", "args": {...}}\`. Inputs bound with @path write the person's edits into the data model.
- Text with data: \`{"@call": "formatString", "args": {"value": "Hello \${/user/name}, \${formatCurrency(value: \${/total}, currency: 'KRW')}"}}\`. There are no operators like +.
- Validation: inputs and Buttons take \`"@checks": [{"condition": {"@call": "required", "args": {"value": {"@path": "/form/email"}}}, "message": "Email is required."}]\`. A Button is disabled while its checks fail.
- A Button action is \`{"event": {"name": "submitBooking", "userMessage": "...", "context": {"seat": {"@path": "/seat"}}}}\` (sent to you) or \`{"functionCall": {"@call": "openUrl", "args": {"url": "https://..."}}}\` (runs locally).
- When the person presses a Button with an event, you receive their next message with an <a2ui-action> block: the event name, surfaceId, the resolved context and (if the surface has sendDataModel: true) the whole data model. Answer it, and update the same surface with updateComponents/updateDataModel rather than creating a new one when the flow continues.
- The tool replies with errors if the UI is invalid; fix exactly those and call it again. Do not repeat the UI as text.
- Write labels in the person's language. Prefer Cards and Columns for structure; keep it readable on a phone (Rows of at most 3–4 items).

## Components
${components}
Every component may have \`weight\` (flex-grow, only inside Row/Column).

## Functions
${functions}
- @index(offset?) → number: index inside a template.

## Example
\`\`\`json
[{"version": "1.0", "createSurface": {"surfaceId": "signup", "catalogId": "${BASIC_CATALOG_ID}", "sendDataModel": true,
  "components": [
    {"id": "root", "component": "Card", "child": "body"},
    {"id": "body", "component": "Column", "children": ["title", "email", "plan", "agree", "submit"]},
    {"id": "title", "component": "Text", "text": "# Create your account"},
    {"id": "email", "component": "TextField", "label": "Email", "value": {"@path": "/form/email"}, "@checks": [{"condition": {"@call": "email", "args": {"value": {"@path": "/form/email"}}}, "message": "Enter a valid email."}]},
    {"id": "plan", "component": "ChoicePicker", "label": "Plan", "variant": "mutuallyExclusive", "displayStyle": "chips", "options": [{"label": "Free", "value": "free"}, {"label": "Pro", "value": "pro"}], "value": {"@path": "/form/plan"}},
    {"id": "agree", "component": "CheckBox", "label": "I agree to the terms", "value": {"@path": "/form/agree"}},
    {"id": "submit_label", "component": "Text", "text": "Sign up"},
    {"id": "submit", "component": "Button", "variant": "primary", "child": "submit_label",
     "@checks": [{"condition": {"@call": "and", "args": {"values": [{"@call": "email", "args": {"value": {"@path": "/form/email"}}}, {"@path": "/form/agree"}]}}}],
     "action": {"event": {"name": "signUp", "userMessage": {"@call": "formatString", "args": {"value": "Sign up \${/form/email} on the \${/form/plan} plan"}}}}}
  ],
  "dataModel": {"form": {"email": "", "plan": ["free"], "agree": false}}}}]
\`\`\``;
}

/** The `render_ui` tool definition (kept small; the instructions above carry the details). */
export const RENDER_UI_TOOL = {
  name: "render_ui",
  description: "Show interactive UI to the person with A2UI v1.0 messages (see the Generative UI skill instructions). Returns errors to fix when the UI is invalid.",
  inputSchema: {
    type: "object",
    properties: {
      messages: { type: "array", minItems: 1, description: "A2UI v1.0 agent-to-renderer messages, applied in order.", items: { type: "object" } },
    },
    required: ["messages"],
    additionalProperties: false,
  },
};
