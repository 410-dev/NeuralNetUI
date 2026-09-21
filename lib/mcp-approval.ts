const SENSITIVE=/password|passwd|secret|token|authorization|api[_-]?key|credential/i;

function concise(value:unknown){
  if(typeof value==="string")return value.replace(/\s+/g," ").trim().slice(0,240);
  if(typeof value==="number"||typeof value==="boolean")return String(value);
  try{return JSON.stringify(value).slice(0,240);}catch{return "";}
}

/** Builds a user-facing purpose line without asking a second model or echoing likely secrets. */
export function describeMcpApproval(toolName:string,description:unknown,args:Record<string,unknown>,locale:"ko"|"en"){
  const detail=String(description||"").replace(/\s+/g," ").trim().slice(0,360);
  const preferred=["action","command","cmd","query","path","url","prompt","message","title"];
  const keys=[...preferred.filter(key=>key in args),...Object.keys(args).filter(key=>!preferred.includes(key))]
    .filter(key=>!SENSITIVE.test(key)).slice(0,3);
  const request=keys.map(key=>`${key}: ${concise(args[key])}`).filter(item=>!item.endsWith(": ")).join(" · ");
  if(locale==="ko")return [detail||`“${toolName}” MCP 도구를 실행합니다.`,request?`요청 작업: ${request}`:"제공된 인자로 이 도구의 작업을 실행하려고 합니다."].join("\n");
  return [detail||`Run the “${toolName}” MCP tool.`,request?`Requested operation: ${request}`:"The tool will run with the supplied arguments."].join("\n");
}
