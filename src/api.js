export async function request(url, fetcher=globalThis.fetch) {
  const match=url.match(/^\/api\/sets(?:\/([a-z0-9]{2,8})(\/checklist)?)?$/i);
  if(match) url=new URL(match[1] ? `../data/${match[2]?'checklists':'sets'}/${match[1]}.json` : '../data/catalog.json',import.meta.url).href;
  let response;
  try { response=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error('Cannot reach the application API. Check your connection and reload the published site.'); }
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error??`Server request failed (${response.status}). The requested set is not included in this published snapshot.`);}
  try { return await response.json(); }
  catch { throw new Error('The server returned a page instead of JSON. Start node server.js (not a Python/static server), then reload.'); }
}
export async function getSets(){const sets=await request('/api/sets');if(!Array.isArray(sets)||!sets.length||sets.some(set=>typeof set.code!=='string'||typeof set.name!=='string'))throw new Error('Server catalog is empty or invalid. Run npm.cmd run refresh:catalog on the server.');return sets;}
export async function loadSet(code,report=()=>{}){report('Loading prepared set from server…');return request(`/api/sets/${encodeURIComponent(code)}`);}