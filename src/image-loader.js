const cache=new Map();
export function prepareImage(url,{timeout=15000,ImageClass=globalThis.Image}={}) {
  if(!url)return Promise.resolve(false);
  if(cache.has(url))return cache.get(url);
  const promise=new Promise(resolve=>{
    const image=new ImageClass();let done=false;
    const finish=ok=>{if(done)return;done=true;clearTimeout(timer);image.onload=null;image.onerror=null;if(!ok)cache.delete(url);resolve(ok);};
    const timer=setTimeout(()=>finish(false),timeout);
    image.onload=async()=>{try{if(image.decode)await image.decode();finish(true);}catch{finish(false);}};
    image.onerror=()=>finish(false);image.src=url;
  });
  cache.set(url,promise);
  // Bound retained image promises; the browser owns its independent HTTP cache.
  if(cache.size>150)cache.delete(cache.keys().next().value);
  return promise;
}
export async function preparePack(cards,onProgress=()=>{},loader=prepareImage) {
  const urls=[...new Set([...cards.map(i=>i.card.image),...cards.map(i=>i.card.backImage)].filter(Boolean))];
  let cursor=0,completed=0,failed=0;
  onProgress({completed,total:urls.length,failed});
  async function worker(){while(cursor<urls.length){const url=urls[cursor++];if(!await loader(url))failed++;completed++;onProgress({completed,total:urls.length,failed});}}
  await Promise.all(Array.from({length:Math.min(4,urls.length)},worker));
  return {completed,total:urls.length,failed};
}