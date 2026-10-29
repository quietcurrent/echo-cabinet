import { pipeline, env } from './vendor/transformers.min.js';
import { chunkDocuments, rankPassages } from './search-core.mjs';
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = new URL('./models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.useBrowserCache = false; // The app service worker owns its same-origin offline cache.
let extractor, passages = [], embeddings = [], busy = false;
const emit = (type, detail = {}) => self.postMessage({type, ...detail});
async function index(documents) {
  passages = chunkDocuments(documents);
  const nextEmbeddings = [];
  for (let start=0; start<passages.length; start+=4) {
    const batch = passages.slice(start,start+4);
    const output = await extractor(batch.map(p => p.text), {pooling:'mean',normalize:true});
    nextEmbeddings.push(...output.tolist());
    emit('index-progress',{done:Math.min(start+4,passages.length),total:passages.length});
  }
  embeddings = nextEmbeddings;
  emit('ready',{passages:passages.length});
}
self.onmessage = async ({data}) => {
  if (busy) { emit('error',{message:'The lantern is still working. Please try again in a moment.'}); return; }
  busy = true;
  try {
    if (data.type === 'initialize') {
      extractor ??= await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{
        dtype:'q8',device:'wasm',local_files_only:true,
        progress_callback: p => { if(p.status==='progress') emit('load-progress',{progress:p.progress,file:p.file}); }
      });
      await index(data.documents);
    } else if (data.type === 'index') {
      if (!extractor) throw new Error('Light the lantern before indexing.');
      await index(data.documents);
    } else if (data.type === 'search') {
      if (!extractor || !embeddings.length) throw new Error('The archive is not ready yet.');
      const start = performance.now();
      const tensor = await extractor(data.query,{pooling:'mean',normalize:true});
      const results = rankPassages(tensor.tolist()[0],passages,embeddings,{limit:3});
      emit('results',{query:data.query,results,elapsed:Math.round(performance.now()-start)});
    }
  } catch (error) { emit('error',{message:error.message || String(error)}); }
  finally { busy = false; }
};
