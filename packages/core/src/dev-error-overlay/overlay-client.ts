/**
 * Phase 18.α — Dev Error Overlay client IIFE.
 *
 * This file EXPORTS a string (`OVERLAY_CLIENT_SCRIPT`) that is inlined
 * into the SSR `<head>` by the injector. It is NOT compiled as a
 * module; the whole body runs in parse order on every dev page load.
 *
 * Size target: < 10 KB gzipped (current ≈ 2 KB gz). No dependencies.
 * Only touches `window`, `document`, `navigator.clipboard`, and a tiny
 * WeakSet.
 *
 * Listeners installed:
 *   - `window.onerror`          → uncaught script errors
 *   - `unhandledrejection`      → Promise rejections
 *   - custom event `__MANDU_ERROR__` → the server embeds a 500 payload
 *     in the HTML, fires this event on DOMContentLoaded, and the
 *     overlay picks it up. User code can also `dispatchEvent` it to
 *     surface synthetic errors.
 *
 * Everything scoped in an IIFE — NO globals leak except the single
 * `__MANDU_OVERLAY_MOUNTED__` sentinel that prevents double-mount on
 * HMR.
 */
import { OVERLAY_STYLES } from "./overlay-styles";
import {
  OVERLAY_CUSTOM_EVENT,
  OVERLAY_MOUNTED_FLAG,
  OVERLAY_PAYLOAD_ELEMENT_ID,
} from "./types";

/**
 * Build the client-side IIFE body as a string. Parameterised by the
 * style block and the two sentinel names so tests can verify the exact
 * shape without re-declaring the constants.
 */
function buildOverlayClientScript(): string {
  // The IIFE below references the constants through string interpolation,
  // NOT through imports — because it runs in the browser and has no
  // module loader.
  return `(function(){
var MOUNTED=${JSON.stringify(OVERLAY_MOUNTED_FLAG)};
var EVT=${JSON.stringify(OVERLAY_CUSTOM_EVENT)};
var PAYLOAD_ID=${JSON.stringify(OVERLAY_PAYLOAD_ELEMENT_ID)};
if(typeof window==="undefined"||typeof document==="undefined")return;
if(window[MOUNTED]===true)return;
window[MOUNTED]=true;

var STYLE=${JSON.stringify(OVERLAY_STYLES)};
var seen=new WeakSet();

function parseFrames(stack){
  if(typeof stack!=="string"||stack.length===0)return [];
  var lines=stack.split("\\n");
  var out=[];
  for(var i=0;i<lines.length;i++){
    var raw=lines[i];
    var t=raw.trim();
    if(!t||t===stack.split("\\n")[0]&&/^[A-Z][a-zA-Z]*(?:Error)?:/.test(t))continue;
    // Chrome:  "    at fn (file:line:col)"
    // Firefox: "fn@file:line:col"
    var m=t.match(/^at\\s+(.+?)\\s+\\((.+):(\\d+):(\\d+)\\)$/);
    if(!m)m=t.match(/^at\\s+(.+):(\\d+):(\\d+)$/);
    if(m&&m.length===5){
      out.push({fn:m[1],file:m[2],line:parseInt(m[3],10),column:parseInt(m[4],10),raw:raw});
      continue;
    }
    if(m&&m.length===4){
      out.push({fn:"<anonymous>",file:m[1],line:parseInt(m[2],10),column:parseInt(m[3],10),raw:raw});
      continue;
    }
    var ff=t.match(/^(.*?)@(.+):(\\d+):(\\d+)$/);
    if(ff){
      out.push({fn:ff[1]||"<anonymous>",file:ff[2],line:parseInt(ff[3],10),column:parseInt(ff[4],10),raw:raw});
      continue;
    }
    out.push({fn:"<anonymous>",file:t,line:null,column:null,raw:raw});
  }
  return out;
}

function toPayload(err,kind){
  var name="Error",message="",stack="";
  if(err&&typeof err==="object"){
    name=err.name||"Error";
    message=typeof err.message==="string"?err.message:String(err.message||"");
    stack=typeof err.stack==="string"?err.stack:"";
  }else if(typeof err==="string"){
    message=err;
  }else if(err!=null){
    try{message=String(err);}catch(_){message="<unserializable error>";}
  }
  return {
    name:name,
    message:message,
    frames:parseFrames(stack),
    stack:stack,
    kind:kind,
    timestamp:Date.now(),
    url:typeof location!=="undefined"?location.pathname+location.search:undefined,
    userAgent:typeof navigator!=="undefined"?navigator.userAgent:undefined
  };
}

function esc(s){
  if(s==null)return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function fileHref(file,line,col){
  // vscode://file/<abs>:<line>:<col> — falls back gracefully when the
  // host OS has no handler. Relative paths get "//" prefix so the URL
  // still parses, even though the editor may refuse to jump.
  var p=file;
  if(!/^[a-zA-Z]:|^\\//.test(p))p="/"+p;
  var u="vscode://file"+p;
  if(line)u+=":"+line;
  if(col)u+=":"+col;
  return u;
}

function renderFrames(frames){
  if(!frames||frames.length===0)return '<li class="mandu-dev-overlay__frame"><span class="mandu-dev-overlay__frame-fn">&lt;no stack&gt;</span></li>';
  var items=[];
  for(var i=0;i<frames.length&&i<40;i++){
    var f=frames[i];
    var loc=esc(f.file)+(f.line?":"+f.line:"")+(f.column?":"+f.column:"");
    var href=f.file?fileHref(f.file,f.line,f.column):"";
    var locHtml=href?'<a class="mandu-dev-overlay__frame-link" href="'+esc(href)+'">'+loc+'</a>':loc;
    items.push('<li class="mandu-dev-overlay__frame"><span class="mandu-dev-overlay__frame-fn">'+esc(f.fn||"<anonymous>")+'</span><span class="mandu-dev-overlay__frame-loc">'+locHtml+'</span></li>');
  }
  return items.join("");
}

function ensureStyleTag(){
  if(document.getElementById("__mandu-dev-overlay-style"))return;
  var s=document.createElement("style");
  s.id="__mandu-dev-overlay-style";
  s.textContent=STYLE;
  (document.head||document.documentElement).appendChild(s);
}

function copyForAI(payload,btn){
  var text="# Mandu dev error snapshot\\n\\n"
    +"- kind: "+payload.kind+"\\n"
    +"- name: "+payload.name+"\\n"
    +"- message: "+payload.message+"\\n"
    +"- url: "+(payload.url||"")+"\\n"
    +"- routeId: "+(payload.routeId||"")+"\\n"
    +"- timestamp: "+new Date(payload.timestamp).toISOString()+"\\n\\n"
    +"## Stack\\n\\n\`\`\`\\n"+payload.stack+"\\n\`\`\`\\n";
  var done=function(){
    var prev=btn.textContent;
    btn.textContent="Copied!";
    setTimeout(function(){btn.textContent=prev;},1500);
  };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done,function(){
      fallbackCopy(text);done();
    });
  }else{
    fallbackCopy(text);done();
  }
}

function fallbackCopy(text){
  try{
    var ta=document.createElement("textarea");
    ta.value=text;ta.style.position="fixed";ta.style.left="-9999px";
    document.body.appendChild(ta);ta.select();
    try{document.execCommand("copy");}catch(_){}
    document.body.removeChild(ta);
  }catch(_){}
}

function mount(payload){
  if(seen.has(payload))return;
  seen.add(payload);
  ensureStyleTag();
  var root=document.getElementById("__mandu-dev-overlay-root");
  if(!root){
    root=document.createElement("div");
    root.id="__mandu-dev-overlay-root";
    root.className="mandu-dev-overlay";
    root.setAttribute("role","dialog");
    root.setAttribute("aria-modal","true");
    root.setAttribute("aria-label","Mandu dev error overlay");
    (document.body||document.documentElement).appendChild(root);
  }
  var kindLabel=({ssr:"SSR render failed",window:"Uncaught error",unhandledrejection:"Unhandled promise rejection",manual:"Error"})[payload.kind]||"Error";
  var meta="";
  if(payload.routeId||payload.url){
    meta='<div class="mandu-dev-overlay__meta">'
      +(payload.routeId?'<div class="mandu-dev-overlay__meta-item"><span class="mandu-dev-overlay__meta-label">Route</span><span class="mandu-dev-overlay__meta-value">'+esc(payload.routeId)+'</span></div>':'')
      +(payload.url?'<div class="mandu-dev-overlay__meta-item"><span class="mandu-dev-overlay__meta-label">URL</span><span class="mandu-dev-overlay__meta-value">'+esc(payload.url)+'</span></div>':'')
      +'<div class="mandu-dev-overlay__meta-item"><span class="mandu-dev-overlay__meta-label">Time</span><span class="mandu-dev-overlay__meta-value">'+esc(new Date(payload.timestamp).toLocaleTimeString())+'</span></div>'
      +'</div>';
  }
  root.innerHTML='<div class="mandu-dev-overlay__panel">'
    +'<div class="mandu-dev-overlay__header">'
      +'<div class="mandu-dev-overlay__title">'
        +'<span class="mandu-dev-overlay__kind">'+esc(kindLabel)+'</span>'
        +'<span class="mandu-dev-overlay__name">'+esc(payload.name)+'</span>'
      +'</div>'
      +'<div class="mandu-dev-overlay__actions">'
        +'<button type="button" class="mandu-dev-overlay__btn mandu-dev-overlay__btn--primary" data-action="copy">Copy for AI</button>'
        +'<button type="button" class="mandu-dev-overlay__btn" data-action="close" aria-label="Close overlay">Close</button>'
      +'</div>'
    +'</div>'
    +'<div class="mandu-dev-overlay__body">'
      +'<p class="mandu-dev-overlay__message">'+esc(payload.message||"(no message)")+'</p>'
      +meta
      +'<h3 class="mandu-dev-overlay__section-title">Stack frames</h3>'
      +'<ol class="mandu-dev-overlay__frames">'+renderFrames(payload.frames)+'</ol>'
      +(payload.stack?'<h3 class="mandu-dev-overlay__section-title" style="margin-top:16px">Raw stack</h3><pre class="mandu-dev-overlay__stack">'+esc(payload.stack)+'</pre>':'')
    +'</div>'
    +'<div class="mandu-dev-overlay__footer">Dev-only overlay. Press <code>Esc</code> to dismiss. Never shipped in production builds.</div>'
  +'</div>';
  root.hidden=false;

  var onClick=function(e){
    var t=e.target;
    if(!t||!t.getAttribute)return;
    var a=t.getAttribute("data-action");
    if(a==="close")hide();
    else if(a==="copy")copyForAI(payload,t);
  };
  root.onclick=onClick;
}

function hide(){
  var root=document.getElementById("__mandu-dev-overlay-root");
  if(root)root.hidden=true;
}

function handle(err,kind,extra){
  try{
    var p=toPayload(err,kind);
    if(extra&&typeof extra==="object"){
      if(extra.routeId)p.routeId=extra.routeId;
      if(extra.url)p.url=extra.url;
    }
    mount(p);
  }catch(_){
    // overlay must never throw — silent drop.
  }
}

window.addEventListener("error",function(ev){
  if(ev&&ev.error)handle(ev.error,"window");
  else if(ev)handle(ev.message||"Script error",(\"window\"));
});
window.addEventListener("unhandledrejection",function(ev){
  handle(ev&&ev.reason,"unhandled-rejection");
});
window.addEventListener(EVT,function(ev){
  var d=ev&&ev.detail;
  if(!d)return;
  if(d.name||d.message||d.stack){
    var p={
      name:d.name||"Error",
      message:d.message||"",
      frames:d.frames||parseFrames(d.stack||""),
      stack:d.stack||"",
      kind:d.kind||"manual",
      timestamp:d.timestamp||Date.now(),
      routeId:d.routeId,
      url:d.url||(typeof location!=="undefined"?location.pathname+location.search:undefined),
      userAgent:typeof navigator!=="undefined"?navigator.userAgent:undefined
    };
    mount(p);
  }
});
document.addEventListener("keydown",function(e){
  if(e.key==="Escape")hide();
});

function readEmbedded(){
  var el=document.getElementById(PAYLOAD_ID);
  if(!el)return;
  try{
    var data=JSON.parse(el.textContent||"null");
    if(data&&typeof data==="object")mount(data);
  }catch(_){}
}
if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",readEmbedded);
}else{
  readEmbedded();
}

// Public surface (tests + user code)
window.__MANDU_DEV_OVERLAY__={show:function(e){handle(e,"manual");},hide:hide};
})();`;
}

/** The serialized IIFE. Computed once at module-load. */
export const OVERLAY_CLIENT_SCRIPT = buildOverlayClientScript();

/** @internal test-only accessor so tests can recompute / inspect the script. */
export const _testOnly_buildOverlayClientScript = buildOverlayClientScript;
