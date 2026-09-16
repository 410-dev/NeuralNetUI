import type { TokenScope } from "./types.ts";

export type TokenUsageEvent={modelId:string;inputTokens:number;outputTokens:number};

export function weightedTokenUsage(events:TokenUsageEvent[],scope:TokenScope,weights:Record<string,number>){return Math.ceil(events.reduce((sum,event)=>{const raw=scope==="input"?event.inputTokens:scope==="output"?event.outputTokens:event.inputTokens+event.outputTokens;return sum+Math.max(0,raw)*Math.max(.01,weights[event.modelId]||1);},0));}

export function anchoredWindow(firstUseMs:number,nowMs:number,durationSeconds:number){const duration=Math.max(3600,durationSeconds)*1000;const elapsed=Math.max(0,nowMs-firstUseMs);const startsAt=firstUseMs+Math.floor(elapsed/duration)*duration;return{startsAt,resetsAt:startsAt+duration};}
