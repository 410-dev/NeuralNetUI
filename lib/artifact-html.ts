/** Injected before an artifact's scripts. The sandbox keeps its origin opaque. */
export function artifactHtmlWithStorage(content:string,entries:Record<string,string>):string {
  const seed=JSON.stringify(entries).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  const bootstrap=`<script>(function(){
    const values=new Map(Object.entries(${seed}));
    const notify=()=>window.parent.postMessage({type:"nnui-artifact-storage",entries:Object.fromEntries(values)},"*");
    const storage={
      get length(){return values.size},
      key(index){return [...values.keys()][Number(index)]??null},
      getItem(key){return values.get(String(key))??null},
      setItem(key,value){const name=String(key),text=String(value),previous=values.get(name);values.set(name,text);if(JSON.stringify(Object.fromEntries(values)).length>1048576){if(previous===undefined)values.delete(name);else values.set(name,previous);throw new DOMException("Artifact storage quota exceeded","QuotaExceededError")}notify()},
      removeItem(key){if(values.delete(String(key)))notify()},
      clear(){if(values.size){values.clear();notify()}}
    };
    const proxy=new Proxy(storage,{
      get(target,key){return key in target?Reflect.get(target,key):typeof key==="string"?target.getItem(key):undefined},
      set(target,key,value){if(typeof key!=="string"||key in target)return false;target.setItem(key,value);return true},
      deleteProperty(target,key){if(typeof key==="string")target.removeItem(key);return true},
      ownKeys(){return [...values.keys()]},
      getOwnPropertyDescriptor(target,key){return typeof key==="string"&&values.has(key)?{configurable:true,enumerable:true,writable:true,value:values.get(key)}:undefined}
    });
    Object.defineProperty(window,"localStorage",{configurable:false,value:proxy});
  })();</script>`;
  const doctype=/^\s*<!doctype[^>]*>/i.exec(content);
  const at=doctype?.[0].length||0;
  return content.slice(0,at)+bootstrap+content.slice(at);
}

/** Ignore malformed data before it reaches the app's own Local Storage. */
export function artifactStorageEntries(value:unknown):Record<string,string>|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  const entries=Object.entries(value);
  if(entries.length>1000)return;
  let size=0;
  for(const [key,item] of entries){if(typeof item!=="string")return;size+=key.length+item.length;if(size>1048576)return;}
  return Object.fromEntries(entries);
}
