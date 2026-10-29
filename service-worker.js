const CACHE='echo-cabinet-shell-v3';
const ASSETS='echo-cabinet-assets-minilm-v1';
const CORE=['./','./index.html','./style.css','./app.mjs','./samples.mjs','./search-core.mjs','./model-worker.mjs','./icon.svg','./vendor/transformers.min.js','./vendor/ort-wasm-simd-threaded.jsep.mjs'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith('echo-cabinet-')&&n!==CACHE&&n!==ASSETS).map(n=>caches.delete(n)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  const immutableAsset=url.pathname.includes('/vendor/')||url.pathname.includes('/models/');
  const cacheResponse=async response=>{if(response.ok){try{const cache=await caches.open(immutableAsset?ASSETS:CACHE);await cache.put(event.request,response.clone());}catch{/* Caching is best effort; a full browser store must not break online use. */}}return response;};
  event.respondWith(immutableAsset
    ? caches.match(event.request).then(cached=>cached||fetch(event.request).then(cacheResponse))
    : fetch(event.request).then(cacheResponse).catch(()=>caches.match(event.request)));
});
