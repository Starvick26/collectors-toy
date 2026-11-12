let catalog;
export async function packArt(code,key){
  catalog ??= fetch(new URL('../package-images.json', import.meta.url)).then(r=>r.ok?r.json():{}).catch(()=>({}));
  const entry = (await catalog).products?.[code+'/'+key];
  return entry ? {...entry,image:new URL('../'+entry.image, import.meta.url).href} : {image:new URL('../assets/packs/illustrated.svg', import.meta.url).href,attribution:'Original illustrated packaging · not an official product photo'};
}
