import type { TokenScope } from "./types.ts";

export type TokenUsageEvent={modelId:string;inputTokens:number;outputTokens:number};

export function modelAllowedByPlan(servedModelIds:string[],modelId:string,sourceModelId?:string){return servedModelIds.includes(modelId)||Boolean(sourceModelId&&servedModelIds.includes(sourceModelId));}

export function weightedTokenUsage(events:TokenUsageEvent[],scope:TokenScope,weights:Record<string,number>){return Math.ceil(events.reduce((sum,event)=>{const raw=scope==="input"?event.inputTokens:scope==="output"?event.outputTokens:event.inputTokens+event.outputTokens;return sum+Math.max(0,raw)*Math.max(.01,weights[event.modelId]||1);},0));}

export function anchoredWindow(firstUseMs:number,nowMs:number,durationSeconds:number){const duration=Math.max(3600,durationSeconds)*1000;const elapsed=Math.max(0,nowMs-firstUseMs);const startsAt=firstUseMs+Math.floor(elapsed/duration)*duration;return{startsAt,resetsAt:startsAt+duration};}

/** Weights are stored with at most two decimal places, e.g. 1.75. */
export function normalizeModelWeight(value:unknown){const number=Number(value);if(!Number.isFinite(number))return 1;return Math.min(100,Math.max(.01,Math.round(number*100)/100));}
export function hasTwoDecimalPlaces(value:number){return Math.abs(value*100-Math.round(value*100))<1e-6;}
/** "1.75", "2", "0.5" — the shortest form without trailing zeros. */
export function formatModelWeight(value:number){return String(Number(normalizeModelWeight(value).toFixed(2)));}

/** Streamed usage that has not yet been written as an event; it counts toward a live status request. */
export type LiveTokenUsage=TokenUsageEvent&{startedAt:number};
export function firstUseAt(recordedAt:number|undefined,live:LiveTokenUsage[],resetAt?:number){const starts=live.map(item=>item.startedAt).filter(value=>resetAt===undefined||value>resetAt);if(recordedAt!==undefined)starts.push(recordedAt);return starts.length?Math.min(...starts):undefined;}
