/**
 * The A2UI v1.0 basic catalog as this app implements it: component properties, their required fields and enums,
 * and the catalog functions. Mirrors https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json (Apache-2.0);
 * the validator and the prompt are both built from this table so the two cannot drift apart.
 */

export const A2UI_VERSION = "1.0";
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/** How a property is checked. Dynamic kinds accept a literal, {"@path"} or {"@call"}. */
export type PropKind =
  | "string" | "number" | "boolean" | "integer"
  | "dynString" | "dynNumber" | "dynBoolean" | "dynStringList" | "dynValue"
  | "child" | "childList" | "action" | "checks" | "icon" | "tabs" | "options" | "weight";

export interface ComponentSpec {
  props: Record<string, PropKind>;
  required: string[];
  enums?: Record<string, readonly string[]>;
  /** Shown to the model. */
  summary: string;
}

const common = { weight: "weight" as const };
const checkable = { "@checks": "checks" as const };

export const ICON_NAMES = ["accountCircle", "add", "arrowBack", "arrowForward", "attachFile", "calendarToday", "call", "camera", "check", "close", "delete", "download", "edit", "event", "error", "fastForward", "favorite", "favoriteOff", "folder", "help", "home", "info", "locationOn", "lock", "lockOpen", "mail", "menu", "moreVert", "moreHoriz", "notificationsOff", "notifications", "pause", "payment", "person", "phone", "photo", "play", "print", "refresh", "rewind", "search", "send", "settings", "share", "shoppingCart", "skipNext", "skipPrevious", "star", "starHalf", "starOff", "stop", "upload", "visibility", "visibilityOff", "volumeDown", "volumeMute", "volumeOff", "volumeUp", "warning"] as const;

export const COMPONENTS: Record<string, ComponentSpec> = {
  Text: { props: { text: "dynString", variant: "string", ...common }, required: ["text"], enums: { variant: ["caption", "body"] }, summary: "text (simple Markdown: headings #, **bold**, lists; no HTML/images/links). variant caption|body." },
  Image: { props: { url: "dynString", description: "dynString", fit: "string", variant: "string", ...common }, required: ["url"], enums: { fit: ["contain", "cover", "fill", "none", "scaleDown"], variant: ["icon", "avatar", "smallFeature", "mediumFeature", "largeFeature", "header"] }, summary: "url, description (alt), fit, variant (size/shape)." },
  Icon: { props: { name: "icon", ...common }, required: ["name"], summary: `name: one of ${ICON_NAMES.join(", ")} (or {"svgPath": "M..."}).` },
  Video: { props: { url: "dynString", posterUrl: "dynString", ...common }, required: ["url"], summary: "url, posterUrl." },
  AudioPlayer: { props: { url: "dynString", description: "dynString", ...common }, required: ["url"], summary: "url, description." },
  Row: { props: { children: "childList", justify: "string", align: "string", ...common }, required: ["children"], enums: { justify: ["center", "end", "spaceAround", "spaceBetween", "spaceEvenly", "start", "stretch"], align: ["start", "center", "end", "stretch"] }, summary: "horizontal layout. children, justify, align." },
  Column: { props: { children: "childList", justify: "string", align: "string", ...common }, required: ["children"], enums: { justify: ["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly", "stretch"], align: ["center", "end", "start", "stretch"] }, summary: "vertical layout. children, justify, align." },
  List: { props: { children: "childList", direction: "string", align: "string", ...common }, required: ["children"], enums: { direction: ["vertical", "horizontal"], align: ["start", "center", "end", "stretch"] }, summary: "scrollable list; children is usually a template {componentId, path}. direction vertical|horizontal." },
  Card: { props: { child: "child", ...common }, required: ["child"], summary: "a framed container with one child." },
  Tabs: { props: { tabs: "tabs", ...common }, required: ["tabs"], summary: "tabs: [{title, child}] (at least one)." },
  Modal: { props: { trigger: "child", content: "child", ...common }, required: ["trigger", "content"], summary: "trigger (usually a Button) opens content in a dialog." },
  Divider: { props: { axis: "string", ...common }, required: [], enums: { axis: ["horizontal", "vertical"] }, summary: "a separator line. axis." },
  Button: { props: { child: "child", variant: "string", action: "action", ...checkable, ...common }, required: ["child", "action"], enums: { variant: ["default", "primary", "borderless"] }, summary: "child (a Text id), variant default|primary|borderless, action. Disabled while any of its @checks fail." },
  TextField: { props: { label: "dynString", value: "dynString", placeholder: "dynString", variant: "string", ...checkable, ...common }, required: ["label", "value"], enums: { variant: ["longText", "number", "shortText", "obscured"] }, summary: "label, value (bind to a path for input), placeholder, variant longText|number|shortText|obscured, @checks." },
  CheckBox: { props: { label: "dynString", value: "dynBoolean", ...checkable, ...common }, required: ["label", "value"], summary: "label, value (bind to a boolean path)." },
  ChoicePicker: { props: { label: "dynString", variant: "string", options: "options", value: "dynStringList", displayStyle: "string", filterable: "boolean", ...checkable, ...common }, required: ["options", "value"], enums: { variant: ["multipleSelection", "mutuallyExclusive"], displayStyle: ["checkbox", "chips"] }, summary: "options [{label, value}], value (bind to a string array path), variant multipleSelection|mutuallyExclusive, displayStyle checkbox|chips, filterable." },
  Slider: { props: { label: "dynString", min: "number", max: "number", value: "dynNumber", steps: "integer", ...checkable, ...common }, required: ["value", "max"], summary: "label, min (default 0), max, value (bind to a number path), steps." },
  DateTimeInput: { props: { value: "dynString", enableDate: "boolean", enableTime: "boolean", min: "dynString", max: "dynString", label: "dynString", ...checkable, ...common }, required: ["value"], summary: "value (ISO 8601 string, bind to a path; start with \"\"), enableDate, enableTime, min, max, label." },
};

/** Properties every component may carry besides its own. */
export const COMMON_PROPS = new Set(["id", "component", "@catalogId", "@accessibility", "@metadata"]);

export interface FunctionSpec { args: Record<string, PropKind | "regexPattern" | "dynBooleanList">; required: string[]; returns: "validationResult" | "string" | "boolean" | "void" | "number"; summary: string }

export const FUNCTIONS: Record<string, FunctionSpec> = {
  required: { args: { value: "dynValue" }, required: ["value"], returns: "validationResult", summary: "value is present and not empty" },
  regex: { args: { value: "dynString", pattern: "regexPattern" }, required: ["value", "pattern"], returns: "validationResult", summary: "value matches pattern (ECMAScript subset, ≤256 chars)" },
  length: { args: { value: "dynString", min: "integer", max: "integer" }, required: ["value"], returns: "validationResult", summary: "string length within min/max" },
  numeric: { args: { value: "dynNumber", min: "number", max: "number" }, required: ["value"], returns: "validationResult", summary: "number within min/max" },
  email: { args: { value: "dynString" }, required: ["value"], returns: "validationResult", summary: "value is an email address" },
  formatString: { args: { value: "dynString" }, required: ["value"], returns: "string", summary: "interpolates ${/abs/path}, ${relative/path} and ${fn(...)} placeholders" },
  formatNumber: { args: { value: "dynNumber", decimals: "dynNumber", grouping: "dynBoolean" }, required: ["value"], returns: "string", summary: "locale number" },
  formatCurrency: { args: { value: "dynNumber", currency: "dynString", decimals: "dynNumber", grouping: "dynBoolean" }, required: ["value", "currency"], returns: "string", summary: "money with ISO 4217 currency" },
  formatDate: { args: { value: "dynValue", format: "dynString" }, required: ["value", "format"], returns: "string", summary: "Unicode TR35 pattern, e.g. \"yyyy-MM-dd HH:mm\", \"MMM d (E)\"" },
  pluralize: { args: { value: "dynNumber", zero: "dynString", one: "dynString", two: "dynString", few: "dynString", many: "dynString", other: "dynString" }, required: ["value", "other"], returns: "string", summary: "picks the plural form" },
  openUrl: { args: { url: "dynString" }, required: ["url"], returns: "void", summary: "opens an http(s) URL (only from a Button action)" },
  and: { args: { values: "dynBooleanList" }, required: ["values"], returns: "boolean", summary: "all true (≥2 values)" },
  or: { args: { values: "dynBooleanList" }, required: ["values"], returns: "boolean", summary: "any true (≥2 values)" },
  not: { args: { value: "dynBoolean" }, required: ["value"], returns: "boolean", summary: "negation" },
};
