/**
 * Issue #208 — Minimal inline SPA-navigation helper.
 * Issue #220 — body-swap observability + fallback + script re-execution.
 * Issue #222 — hash-anchor preservation across SPA swaps.
 *
 * Self-contained IIFE injected into the SSR `<head>` that upgrades plain
 * full-page navigations into client-side `history.pushState` +
 * `fetch` + DOM-swap transitions, without loading any JS bundle.
 *
 * Motivating use case: docs / blog / marketing sites that build with
 * `hydration: "none"` (no islands). Under Issue #193 the opt-out SPA
 * router lives in `@mandujs/core/client` (`router.ts`), which only ships
 * inside a hydration bundle. Zero-JS pages therefore lost the "feels
 * like a SPA" behavior that `spa: true` (the framework default) promises.
 *
 * This helper fills the gap: ~2.8 KB of inline JavaScript that the
 * browser parses and runs immediately, no module graph, no network
 * round-trip. Paired with the `@view-transition { navigation: auto }`
 * style block (#192) the result is a visually-animated pushState
 * navigation on every internal link click.
 *
 * Design constraints (locked — changing any of these needs an explicit
 * rationale in the PR):
 *
 *   1. **Exclusion parity with the full router** (`router.ts`
 *      `handleLinkClick`): every browser-owned escape hatch — modifier
 *      keys, non-left click, `target` other than `_self`, `download`,
 *      `mailto:` / `tel:` / `javascript:` / …, cross-origin, hash-only,
 *      no `href`, `data-no-spa`, and `event.defaultPrevented` — is
 *      checked here too. Regression matrix lives at
 *      `tests/client/spa-nav-helper-exclusions.test.ts`.
 *
 *   2. **Co-existence with the full router**: both handlers listen
 *      on `document` `click`. The helper bails out early when
 *      `window.__MANDU_ROUTER_STATE__` is present — that global is
 *      installed by `initializeRouter()` before it calls
 *      `addEventListener`, so on hydrated pages the full router wins.
 *      On pure-SSR pages the state global is missing and the helper
 *      is authoritative.
 *
 *   3. **View Transitions API** — we call
 *      `document.startViewTransition(cb)` when available, mirroring the
 *      `@view-transition` at-rule we already inject. Browsers without
 *      the API (Firefox, Safari < 18.2) execute the callback
 *      synchronously so the feature is a pure progressive enhancement.
 *
 *   4. **DOM swap strategy** (issue #220 rework):
 *      - Prefer `<main>` → `<#root>` → whole `<body>` (in that order).
 *        We log which container matched via `console.debug`.
 *      - Scripts inside the swapped region are extracted and
 *        re-executed via `document.createElement("script")` so
 *        island bootstraps / inline user scripts still fire.
 *      - Head `<title>` + selective meta tags are merged from the
 *        incoming document.
 *
 *   5. **Observability + fallback** (issue #220): every failure path
 *      (fetch !ok, DOMParser unavailable, parser error, no container
 *      matched, exception inside swap, exception inside
 *      startViewTransition) logs a `console.warn("[mandu-spa-nav] …")`
 *      and performs a hard navigation (`location.href = url`) so the
 *      user always sees fresh content. No silent stuck-URL state.
 *
 *   6. **Hydration marker** (issue #220): after a successful swap we
 *      dispatch `__MANDU_SPA_NAV__` on `window` with
 *      `detail: { url, durationMs, container }` so islands and
 *      integrations can re-hydrate if needed.
 *
 *   6b. **Hash anchor preservation** (issue #222): after a successful
 *      swap, if the target URL carries a `#hash`, the helper resolves
 *      `document.getElementById(hash)` (with a fallback to
 *      `[name="<hash>"]`) and calls `scrollIntoView({block:"start"})`
 *      so `<a href="/docs#intro">` lands on `<h1 id="intro">` instead
 *      of the top of the page. Missing targets fall back to `scrollTo(0,0)`.
 *      Same-page hash navigation (identical pathname + search) skips the
 *      body swap entirely — only pushState + scrollIntoView fire.
 *      `CSS.escape` is used when available to handle punctuation in ids.
 *
 *   7. **Inline, not external**: same rationale as #192's prefetch
 *      helper — inline removes the extra round-trip on every SSR
 *      response, keeps the CSP posture simple, and sidesteps the
 *      "zero-JS but loads one JS file anyway" awkwardness.
 *
 *   8. **Opt-out via `ssr.spa: false`**: the injection site
 *      (`ssr.ts::renderToHTML`, `streaming-ssr.ts::generateHTMLShell`)
 *      omits the `<script>` block entirely when the user's config sets
 *      `spa: false`. No runtime check needed inside the IIFE.
 *
 * Size target: ≤3 KB gzipped (currently ≈2.8 KB raw, ≈1.4 KB gz). If
 * this grows past 3 KB gz we should revisit the inline-vs-external
 * trade-off.
 */

/**
 * Inner IIFE — exposed for unit tests that want to parse the source.
 *
 * Byte-minified on purpose (no comments, short names). The high-level
 * flow is documented in this file's JSDoc; anyone editing this string
 * MUST update the exclusion-matrix test and the body-swap test to match.
 */
export const SPA_NAV_HELPER_BODY = `(function(){if(typeof document==="undefined"||typeof window==="undefined")return;var L=window.location;var H=window.history;var TAG="[mandu-spa-nav]";function warn(m,d){try{console.warn(TAG+" "+m,d==null?"":d);}catch(_){}}function info(m,d){try{console.debug(TAG+" "+m,d==null?"":d);}catch(_){}}function hardNav(u,why){warn("falling back to full navigation: "+why,u);try{L.href=u;}catch(_){}}function esc(h){try{if(typeof CSS!=="undefined"&&CSS&&typeof CSS.escape==="function")return CSS.escape(h);}catch(_){}return String(h).replace(/([^a-zA-Z0-9_-])/g,"\\\\$1");}function extractHash(u){var i=u.indexOf("#");return i>=0?u.slice(i+1):"";}function scrollToHash(hash,url){if(!hash){try{window.scrollTo(0,0);}catch(_){}return;}var el=null;try{el=document.getElementById?document.getElementById(hash):null;}catch(_){}if(!el){try{el=document.querySelector?document.querySelector('[name="'+esc(hash)+'"]'):null;}catch(_){}}if(el&&typeof el.scrollIntoView==="function"){try{el.scrollIntoView({behavior:"instant",block:"start"});}catch(e1){try{el.scrollIntoView();}catch(_){}}try{if(L.hash!=="#"+hash)L.hash="#"+hash;}catch(_){}info("scrolled to #"+hash,url==null?"":url);}else{info("hash target #"+hash+" not found, scrolling to top",url==null?"":url);try{window.scrollTo(0,0);}catch(_){}}}function okAnchor(a){if(!a||!a.getAttribute)return null;if(a.hasAttribute("data-no-spa"))return null;if(a.hasAttribute("download"))return null;var t=a.getAttribute("target");if(t&&t!=="_self")return null;var h=a.getAttribute("href");if(!h)return null;var u;try{u=new URL(h,L.href);}catch(_){return null;}if(u.origin!==L.origin)return null;if(u.protocol!=="http:"&&u.protocol!=="https:")return null;if(u.pathname===L.pathname&&u.search===L.search&&!u.hash)return null;return u;}function pickContainer(doc){var main=doc.querySelector("main");if(main)return{src:main,dst:document.querySelector("main"),kind:"main"};var root=doc.getElementById&&doc.getElementById("root");if(root){var dstR=document.getElementById?document.getElementById("root"):null;if(dstR)return{src:root,dst:dstR,kind:"#root"};}if(doc.body)return{src:doc.body,dst:document.body,kind:"body"};return null;}function mergeHead(doc){try{var newTitle=doc.querySelector("title");if(newTitle)document.title=newTitle.textContent||document.title;var nh=doc.head,ch=document.head;if(!nh||!ch)return;var keep={};var metas=ch.querySelectorAll("meta[name=viewport],meta[charset]");for(var i=0;i<metas.length;i++)keep[metas[i].outerHTML]=true;var sel="meta,link[rel=icon],link[rel=shortcut icon],link[rel=canonical]";var oldMetas=ch.querySelectorAll(sel);for(var j=0;j<oldMetas.length;j++){if(!keep[oldMetas[j].outerHTML])oldMetas[j].parentNode.removeChild(oldMetas[j]);}var newMetas=nh.querySelectorAll(sel);for(var k=0;k<newMetas.length;k++){if(!keep[newMetas[k].outerHTML])ch.appendChild(newMetas[k].cloneNode(true));}}catch(e){warn("head merge failed",e&&e.message||e);}}function runScripts(container){try{var scripts=container.querySelectorAll("script");for(var i=0;i<scripts.length;i++){var old=scripts[i];var s=document.createElement("script");for(var j=0;j<old.attributes.length;j++){var a=old.attributes[j];try{s.setAttribute(a.name,a.value);}catch(_){}}if(!old.src)s.text=old.textContent||"";old.parentNode&&old.parentNode.removeChild(old);(document.head||document.body||document.documentElement).appendChild(s);}}catch(e){warn("script re-exec failed",e&&e.message||e);}}function doSwap(doc,url,startedAt){var perr=doc.querySelector&&doc.querySelector("parsererror");if(perr){hardNav(url,"DOMParser returned parsererror");return false;}var pick=pickContainer(doc);if(!pick||!pick.dst){hardNav(url,"no swap container matched (main/#root/body)");return false;}info("swap target container: "+pick.kind);try{pick.dst.innerHTML=pick.src.innerHTML;}catch(e){hardNav(url,"innerHTML assignment threw: "+(e&&e.message||e));return false;}mergeHead(doc);runScripts(pick.dst);scrollToHash(extractHash(url),url);var dur=0;try{dur=Math.round((performance&&performance.now?performance.now():Date.now())-startedAt);}catch(_){}info("swapped to "+url+" in "+dur+"ms (container="+pick.kind+")");try{window.dispatchEvent(new CustomEvent("__MANDU_SPA_NAV__",{detail:{url:url,durationMs:dur,container:pick.kind}}));}catch(_){}try{window.dispatchEvent(new CustomEvent("mandu:spa-navigate",{detail:{url:url}}));}catch(_){}return true;}function nav(url,push){var startedAt=0;try{startedAt=performance&&performance.now?performance.now():Date.now();}catch(_){startedAt=Date.now();}fetch(url,{credentials:"same-origin",headers:{"Accept":"text/html"}}).then(function(r){if(!r.ok){hardNav(url,"fetch responded "+r.status);return null;}var ct=r.headers.get("content-type");if(!ct||ct.indexOf("text/html")<0){hardNav(url,"non-HTML response ("+(ct||"no content-type")+")");return null;}return r.text();}).then(function(html){if(html==null)return;if(typeof DOMParser==="undefined"){hardNav(url,"DOMParser unavailable");return;}var doc;try{doc=new DOMParser().parseFromString(html,"text/html");}catch(e){hardNav(url,"DOMParser threw: "+(e&&e.message||e));return;}if(push){try{H.pushState({mandu:1},"",url);}catch(e){hardNav(url,"pushState threw: "+(e&&e.message||e));return;}}var run=function(){doSwap(doc,url,startedAt);};if(typeof document.startViewTransition==="function"){try{document.startViewTransition(run);}catch(e){warn("startViewTransition threw, running swap directly",e&&e.message||e);run();}}else{run();}}).catch(function(e){hardNav(url,"fetch rejected: "+(e&&e.message||e));});}function samePageHashNav(u,push){var url=u.pathname+u.search+u.hash;if(push){try{H.pushState({mandu:1},"",url);}catch(e){warn("pushState threw on same-page hash nav",e&&e.message||e);}}info("same-page hash nav "+url);scrollToHash(u.hash?u.hash.slice(1):"",url);try{window.dispatchEvent(new CustomEvent("__MANDU_SPA_NAV__",{detail:{url:url,durationMs:0,container:"hash"}}));}catch(_){}}document.addEventListener("click",function(e){if(e.defaultPrevented)return;if(e.button!==0||e.metaKey||e.altKey||e.ctrlKey||e.shiftKey)return;if(window.__MANDU_ROUTER_STATE__)return;var tgt=e.target;var a=tgt&&typeof tgt.closest==="function"?tgt.closest("a"):null;if(!a)return;var url=okAnchor(a);if(!url)return;e.preventDefault();if(url.pathname===L.pathname&&url.search===L.search&&url.hash){samePageHashNav(url,true);return;}nav(url.pathname+url.search+url.hash,true);},false);window.addEventListener("popstate",function(){if(window.__MANDU_ROUTER_STATE__)return;nav(L.pathname+L.search+L.hash,false);});window.__MANDU_SPA_HELPER__=1;})();`;

/** Ready-to-inject `<script>` tag for SSR `<head>` injection. */
export const SPA_NAV_HELPER_SCRIPT = `<script>${SPA_NAV_HELPER_BODY}</script>`;
