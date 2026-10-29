import { samples } from './samples.mjs';
const $ = id => document.getElementById(id);
let documents = [...samples], worker, ready = false, searching = false, importing = false, pendingQuery = '', modelStarted = false;
const status = text => {$('engine-status').textContent=text;};
function controls() {
  $('search-button').disabled=!ready || searching || importing;
  $('files').disabled=searching || importing || (modelStarted && !ready);
  $('restore-samples').disabled=searching || importing || (modelStarted && !ready);
  $('load-model').disabled=modelStarted || importing;
  $('clear-cache').disabled=searching || importing || (modelStarted && !ready);
}
function openDocument(id) {
  const doc=documents.find(d=>d.id===id); if(!doc) return;
  $('dialog-meta').textContent=doc.date ? `FICTIONAL CORRESPONDENCE · ${doc.date}` : 'LOCAL IMPORT · NOT UPLOADED';
  $('dialog-title').textContent=doc.title; $('dialog-text').textContent=doc.text;
  $('letter-dialog').showModal();
}
function renderDocuments() {
  $('document-grid').replaceChildren();
  documents.forEach((doc,i)=>{
    const card=document.createElement('button');card.className='document';
    const meta=document.createElement('span');meta.className='doc-meta';meta.textContent=doc.date || 'LOCAL IMPORT';
    const title=document.createElement('h3');title.textContent=doc.title;
    const excerpt=document.createElement('p');excerpt.textContent=doc.teaser || doc.text.slice(0,85)+'…';
    const bottom=document.createElement('span');bottom.className='doc-bottom';
    const label=document.createElement('span');label.textContent=`${String(i+1).padStart(2,'0')} / ${doc.tag || 'YOUR ARCHIVE'}`;
    const arrow=document.createElement('b');arrow.textContent='↗';bottom.append(label,arrow);
    card.append(meta,title,excerpt,bottom);card.addEventListener('click',()=>openDocument(doc.id));$('document-grid').append(card);
  });
  $('scene-count').textContent=documents.length;
}
function renderResults({query,results,elapsed}) {
  $('results-list').replaceChildren();
  $('results-context').textContent=`Following: “${query}”`;
  $('search-time').textContent=`LOCAL INFERENCE / ${(elapsed/1000).toFixed(2)}s`;
  results.forEach(({passage,score},i)=>{
    const article=document.createElement('article');article.className='result';
    const number=document.createElement('span');number.className='result-number';number.textContent=String(i+1).padStart(2,'0');
    const body=document.createElement('div'), meta=document.createElement('div');meta.className='result-meta';
    const title=document.createElement('h3');title.textContent=passage.title;
    const similarity=document.createElement('span');similarity.className='score';similarity.textContent=`COSINE SIMILARITY ${score.toFixed(3)}`;
    meta.append(title,similarity);
    const quote=document.createElement('blockquote');quote.textContent=passage.text;
    const source=document.createElement('button');source.className='source-button';source.textContent=`Read source ↗ · characters ${passage.offset}–${passage.offset+passage.text.length}`;
    source.addEventListener('click',()=>openDocument(passage.documentId));body.append(meta,quote,source);article.append(number,body);$('results-list').append(article);
  });
  $('results').hidden=false;$('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}
function search(query) {
  query=query.trim(); if(!query) return;
  $('query').value=query;
  if(importing){pendingQuery=query;status('Reading your local letters first…');return;}
  if(!ready) {pendingQuery=query;status(modelStarted?'The lantern is still warming…':'Light the lantern to follow this memory');return;}
  if(searching) return;searching=true;controls();status('Following a memory…');worker.postMessage({type:'search',query});
}
async function startModel() {
  if(modelStarted || importing) return;
  modelStarted=true;ready=false;controls();$('load-model').disabled=true;$('load-progress').hidden=false;
  status('Downloading the local lantern…');$('engine-detail').textContent='Loading the pinned model and WebAssembly runtime from this app. Your text is not sent.';
  if('serviceWorker' in navigator) {
    try {
      await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(resolve,4000))]);
      if(!navigator.serviceWorker.controller)await new Promise(resolve=>{navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});setTimeout(resolve,1000);});
    } catch {}
  }
  if(!modelStarted)return;
  try{worker=new Worker(new URL('./model-worker.mjs',import.meta.url),{type:'module'});}catch(error){handleError(error.message);return;}
  worker.onmessage=({data})=>{
    if(data.type==='load-progress') {$('load-progress').value=data.progress || 0;status(`Loading model · ${Math.round(data.progress || 0)}%`);}
    else if(data.type==='index-progress') {status(`Reading the archive · ${data.done}/${data.total}`);}
    else if(data.type==='ready') {
      ready=true;searching=false;controls();status(`Lantern lit · ${data.passages} passages indexed`);$('load-progress').hidden=true;$('load-model').hidden=true;
      $('engine-detail').textContent='The open model is running locally. Search your archive by meaning.';
      if(pendingQuery){const q=pendingQuery;pendingQuery='';search(q);}
    } else if(data.type==='results') {searching=false;controls();status('Lantern lit · ready for another memory');renderResults(data);}
    else if(data.type==='error') handleError(data.message);
  };
  worker.onerror=error=>handleError(error.message || 'The browser could not start the local model.');
  worker.postMessage({type:'initialize',documents});
}
function handleError(message) {
  searching=false;ready=false;modelStarted=false;worker?.terminate();worker=null;controls();status('The lantern needs another try');
  $('engine-detail').textContent=`${message} The archive can still be read without AI. Try reloading, or use a current browser with WebAssembly.`;
  $('load-model').hidden=false;$('load-model').disabled=false;$('load-model').textContent='Try lighting the lantern again ↗';$('load-progress').hidden=true;
}
$('load-model').addEventListener('click',startModel);
$('search-form').addEventListener('submit',event=>{event.preventDefault();search($('query').value);});
document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>search(button.dataset.query)));
$('files').addEventListener('change',async event=>{
  const files=Array.from(event.target.files || []);if(!files.length)return;
  if(searching || importing || (modelStarted && !ready))return;
  importing=true;controls();
  try {
    if(files.length>8)throw new Error('Choose at most 8 text files.');
    const next=[];let total=0;
    for(const [i,file] of files.entries()) {
      if(!/\.(txt|md)$/i.test(file.name))throw new Error('Only .txt and .md files are supported.');
      if(file.size>50000)throw new Error('One file is too large. Use shorter excerpts.');
      const text=await file.text();if(!text.trim())throw new Error('Empty files cannot be indexed.');
      if(text.length>12000)throw new Error('Keep each letter below 12,000 characters.');
      total+=text.length;if(total>40000)throw new Error('Keep the whole archive below 40,000 characters.');
      next.push({id:`local-${i+1}`,title:file.name,text});
    }
    documents=next;renderDocuments();$('results').hidden=true;$('restore-samples').hidden=false;
    $('archive-note').textContent=`${documents.length} local text ${documents.length===1?'file':'files'} · held in this tab only.`;
    $('file-status').textContent='Imported locally. Nothing was uploaded.';
    if(ready){ready=false;controls();worker.postMessage({type:'index',documents});}
  } catch(error){$('file-status').textContent=error.message;}
  finally{importing=false;controls();event.target.value='';}
});
$('restore-samples').addEventListener('click',()=>{
  documents=[...samples];renderDocuments();$('results').hidden=true;$('restore-samples').hidden=true;$('file-status').textContent='Fictional archive restored.';
  $('archive-note').textContent='Eight fictional letters, written for this experiment. No historical claims.';
  if(ready){ready=false;controls();worker.postMessage({type:'index',documents});}
});
$('letter-dialog').querySelector('.close-dialog').addEventListener('click',()=>$('letter-dialog').close());
$('letter-dialog').addEventListener('click',event=>{if(event.target===$('letter-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('clear-cache').addEventListener('click',async()=>{
  if(!('caches' in window)){$('cache-status').textContent='This browser does not expose offline cache storage.';return;}
  try{const names=await caches.keys();await Promise.all(names.filter(n=>n.startsWith('echo-cabinet-')).map(n=>caches.delete(n)));$('cache-status').textContent='Echo Cabinet’s offline cache cleared. The next reload needs a connection.';}
  catch{$('cache-status').textContent='The browser could not clear the offline cache.';}
});
renderDocuments();
if('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('./service-worker.js',import.meta.url)).catch(()=>{});
