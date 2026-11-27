import { A2uiGenerator, CatalogConfig, ExpressFormatFactory, InMemoryCatalogProvider, type A2uiRequestProcessor } from "@a2ui/agent";
import basicCatalog from "./vendor/basic-catalog-v1_0.json";
import type { AgentMessage } from "./runtime";

/**
 * A2UI Express: the compact DSL Google recommends for generating A2UI (about a third of the output tokens of the JSON
 * messages). Compiled on the server with the official SDK (@a2ui/agent) against the v1.0 basic catalog; the result is
 * ordinary v1.0 messages, drawn by the same renderer as the JSON skill.
 */

let processor: A2uiRequestProcessor | undefined;
function express() {
  if (processor) return processor;
  const catalog = new CatalogConfig(new InMemoryCatalogProvider(basicCatalog as Record<string, unknown>).load());
  const generator = new A2uiGenerator([catalog], undefined, new ExpressFormatFactory());
  processor = generator.createProcessor({ "1.0": { supportedCatalogIds: [basicCatalog.catalogId] } });
  return processor;
}

let instructions: string | undefined;
/**
 * The SDK's own Express contract, with the per-parameter prose dropped (enum choices kept) so it costs far fewer
 * tokens, and with the delivery rule changed from inline <a2ui> tags to the render_ui_express tool.
 */
export function expressInstructions() {
  if (instructions) return instructions;
  const snippet = express().promptSnippet;
  const body = snippet.slice(Math.max(0, snippet.indexOf("## Grammar Rules")));
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    const param = /^ {2}- ([^:]+): (.*)$/.exec(line);
    if (param) {
      const choices = /Must be one of: (.*)$/.exec(param[2]);
      if (choices) lines.push(`  - ${param[1]}: ${choices[1]}`);
      continue;
    }
    lines.push(line);
  }
  instructions = `# Skill: Generative UI (A2UI Express)

You can show the person interactive UI (cards, forms, lists, tabs, dialogs) by calling the \`render_ui_express\` tool with \`ui\`: an A2UI Express program (what would go between <a2ui> and </a2ui>; the tags are optional). Use it when structure helps: forms, choices, dashboards, comparisons, step-by-step flows. Keep plain answers as text.

- Start each program with \`surface("some-id")\`. Add \`sendDataModel=true\` (\`surface("booking", sendDataModel=true)\`) when you need the form's values back.
- To change a UI you already showed, call the tool again with \`surface("<same id>")\` and only the variables or data paths that change. To remove it: \`deleteSurface("<id>")\`.
- When the person presses a Button with an Event, their next message carries an <a2ui-action> block with the event name, the resolved context and (with sendDataModel) the data model. Continue the same surface when the flow goes on.
- The tool replies with compile errors when the program is invalid; fix exactly those and call it again. Do not repeat the UI as text.
- Write labels in the person's language and keep it readable on a phone.

${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}`;
  return instructions;
}

export const RENDER_UI_EXPRESS_TOOL = {
  name: "render_ui_express",
  description: "Show interactive UI to the person with an A2UI Express program (see the Generative UI (A2UI Express) skill instructions). Returns compile errors to fix.",
  inputSchema: {
    type: "object",
    properties: { ui: { type: "string", description: "The A2UI Express program, starting with surface(\"id\")." } },
    required: ["ui"],
    additionalProperties: false,
  },
};

/** Compiles a program against the surfaces earlier calls left, so it may update them. */
export function compileExpress(source: string, history: AgentMessage[][]): { messages: AgentMessage[] } | { error: string } {
  const program = source.replace(/^\s*```[a-zA-Z0-9]*\s*\n?|\n?\s*```\s*$/g, "").replace(/^\s*<a2ui>\s*|\s*<\/a2ui>\s*$/g, "").trim();
  if (!program) return { error: "`ui` is empty." };
  const engine = express();
  const state = engine.createState();
  for (const batch of history) {
    try { state.apply(batch); } catch { /* an earlier surface the SDK cannot reload stays out of the state */ }
  }
  try {
    const parts = engine.parseResponse(`<a2ui>\n${program}\n</a2ui>`, { state });
    const messages = parts.flatMap(part => part.type === "a2ui" ? part.a2ui as unknown as AgentMessage[] : []);
    if (!messages.length) return { error: "The program produced no UI. Start it with surface(\"id\") and assign root." };
    return { messages };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
