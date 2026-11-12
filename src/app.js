import { getSets, loadSet } from './api.js';
import { loadState, saveState, downloadBackup, validateBackup } from './storage.js';
import { simulatePack, inventory, cardKey, priceOf } from './simulator.js';
import { resolveProduct, queueProgress } from './products.js';
import { normalizeInteractions, binderLocations } from './interactions-model.js';
import { createExperience } from './card-experience.js';
import { preparePack } from './image-loader.js';
import { packArt } from './pack-art.js';
import { createCardViewer } from './card-viewer.js';
import { artists, matchesCard, setProgress, sortCollection } from './collection-model.js';
import { request } from './api.js';
import { unwrapPack } from './pack-opening.js';
import { applyFoil } from './foil.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => value == null ? 'Price unavailable' : `$${value.toFixed(2)}`;
const image = card => /^https:\/\//.test(card?.image ?? '') ? escape(card.image) : '';
const img = (card, extra = '', finish = 'nonfoil') => `<img src="${image(card)}" alt="${escape(card.name)}" data-card-finish="${escape(finish)}" ${extra}>`;
const tags = card => [...new Set([...(card.frame_effects ?? []), ...(card.promo_types ?? []), ...(card.border_color === 'borderless' ? ['borderless'] : [])])];
let state, loaded = null, sets = [], current = null, reveal = -1, busy = false;
let toastTimer;
const metadata=new Map(), checklists=new Map();let lastOpened=null, removedCard=null,nextOpeningBusy=false;
const viewCard=createCardViewer(()=>state,async(source,key)=>{const next=structuredClone(state),binder=next.binders.find(b=>b.id===source.id);if(binder?.slots[source.position]!==key)throw new Error('This card has moved.');binder.slots[source.position]=null;removedCard={source,key};await commit(next);toast('Removed from binder only. Use Undo removal in Binders.');});
document.addEventListener('view-card',event=>{const {card,finish,source}=event.detail;viewCard({...card,...metadata.get(card.id),prices:card.prices},finish,source);});
const experience = createExperience({ getState: () => state, commit: next => commit(next), getOpening: () => current ? { pack: current, index: reveal, item: current.cards[reveal] } : null, advance: () => { reveal++; renderStage(); }, rewind: () => { reveal--; renderStage(); }, refresh: () => renderStage(), report: text => toast(text) });
function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 6000); }
async function commit(next) { await saveState(next); state = next; renderAll(); }
async function safely(action) { try { await action(); } catch (error) { console.error(error); toast(error.message); } }
function showView(view) {
  if(view==='collection'&&state)loadChecklists();
  for (const element of document.querySelectorAll('.view')) element.classList.toggle('active', element.id === `${view}View`);
  for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === view);
}
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));

// Product counts are custom unless populated from a specific verified catalog.
$('openView').insertAdjacentHTML('beforeend', `<section class="panel cart-panel"><div class="cart-heading"><div><div class="eyebrow">SEALED PRODUCTS</div><h3>Build an opening queue</h3><p class="notice">Displays use their usual booster type: 30 Play Boosters or 12 Collector Boosters. Bundle and Prerelease extras are not simulated yet.</p></div><div class="cart-badge">LOCAL<br><span>QUEUE</span></div></div><div class="cart-inputs"><label>Product group<select id="groupSelect"><option value="single">Single booster</option><option value="prerelease">Prerelease Pack · 6 Play Boosters</option><option value="bundle">Bundle · 9 Play Boosters</option><option value="play-display">Play Booster Display · 30 Play Boosters</option><option value="collector-display">Collector Booster Display · 12 Collector Boosters</option><option value="custom-36">Custom group · 36 boosters</option></select></label><label>Estimated group price (USD)<input id="groupPrice" type="number" min="0" step="0.01" placeholder="Optional"></label><button id="addQueue" class="secondary"><span class="button-icon">＋</span> Add to queue</button></div><div id="queueList"></div></section>`);
$('collectionView').insertAdjacentHTML('beforeend', '<section id="setProgress" class="progress-panels"></section>');
document.body.insertAdjacentHTML('beforeend', '<footer>Unofficial Magic: The Gathering fan project. Card images © Wizards of the Coast. Data: <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a> & <a href="https://mtgjson.com" target="_blank" rel="noreferrer">MTGJSON</a>. Prices are estimates in USD, not offers. Local data stays in this browser; export backups regularly.</footer>');

async function selectSet(code) {
  if (busy) return;
  busy = true; $('loadSetButton').disabled = true; $('openButton').disabled = true; $('addQueue').disabled = true;
  loaded = null;
  try {
    $('sourceNote').textContent = 'Loading booster configurations…';
    loaded = await loadSet(code, text => { $('sourceNote').textContent = text; });
    $('setSelect').value = code;
    $('productSelect').innerHTML = loaded.configs.length ? loaded.configs.map(config => `<option value="${escape(config.key)}" ${!config.available ? 'disabled' : ''}>${escape(config.name ?? config.key)}${config.reason ? ` — ${escape(config.reason)}` : ''}</option>`).join('') : '<option value="">No booster configurations available</option>';
    const first = loaded.configs.find(c => c.available);
    if (first) $('productSelect').value = first.key;
    $('openButton').disabled = !first; $('addQueue').disabled = !first;
    $('sourceNote').textContent = `Prepared on server: ${loaded.updatedAt ?? 'unknown date'} · MTGJSON weighted sheets · Physical order unverified; color collation approximate. Unresolved products are disabled.`;
    renderAll();
  } catch (error) { $('sourceNote').textContent = `Unable to load this set: ${error.message}`; throw error; }
  finally { busy = false; $('loadSetButton').disabled = false; }
}
$('loadSetButton').onclick = () => safely(async () => { if (!$('setSelect').value) throw new Error('Choose a set first.'); await selectSet($('setSelect').value); });
$('setSelect').onchange = () => { $('openButton').disabled = !loaded || loaded.code !== $('setSelect').value; $('addQueue').disabled = $('openButton').disabled; };

async function openPack(queueIndex = null) {
  if (busy || $('openingStage').classList.contains('unwrapping')) return;
  const queued = queueIndex === null ? null : state.queue[queueIndex];
  if (queued && loaded?.code !== queued.setCode) await selectSet(queued.setCode);
  const config = loaded?.configs.find(c => c.key === (queued?.configKey ?? $('productSelect').value));
  if (!config?.available) throw new Error('This booster configuration is not available.');
  busy = true;
  try {
    const result = simulatePack(config, loaded.index);
    const pack = { id: crypto.randomUUID(), date: new Date().toISOString(), setCode: loaded.code, setName: loaded.set.name, productName: config.name ?? config.key, configKey: config.key, priceDate: new Date().toISOString(), ...result };
    const next = structuredClone(state); next.history.unshift(pack); next.activeOpening = {id:pack.id,index:-1};
    if (queued && --next.queue[queueIndex].count === 0) next.queue.splice(queueIndex, 1);
    // Persist the complete pack atomically before starting the reveal. Refresh cannot reroll it.
    await commit(next); current = pack;lastOpened={setCode:pack.setCode,configKey:pack.configKey}; reveal = -1; renderStage(); showView('open');
  } finally { busy = false;renderNextOpening(); }
}
$('openButton').onclick = () => safely(() => openPack());
function renderStage() {
  if (!current) return;
  renderNextOpening();
  const stage = $('openingStage'); stage.classList.remove('empty');
  if (reveal < 0) {
    experience.decorate();
    stage.innerHTML = `<div class="sealed-pack"><div class="eyebrow">${escape(current.setName)}</div><div class="pack-mark">✦</div><h3>${escape(current.productName)}</h3><span>${current.cards.length} cards inside</span></div><p class="notice">Saved to your history. Composition model: MTGJSON · Reveal order unverified.</p><button id="tearPack" class="primary">Tear open</button>`;
    const pack=current;
    const wrapper=stage.querySelector('.sealed-pack');
    wrapper.setAttribute('role','button');wrapper.tabIndex=0;wrapper.setAttribute('aria-label','Open booster');wrapper.setAttribute('aria-disabled','true');
    const artwork=document.createElement('img');artwork.className='pack-artwork';artwork.alt='Booster packaging';artwork.src=new URL('../assets/packs/illustrated.svg', import.meta.url).href;wrapper.prepend(artwork);wrapper.querySelector('.pack-mark').remove();
    packArt(pack.setCode,pack.configKey).then(art=>{if(!wrapper.isConnected)return;artwork.src=art.image;artwork.onerror=()=>{artwork.onerror=null;artwork.src=new URL('../assets/packs/illustrated.svg', import.meta.url).href;};const caption=document.createElement('small');caption.textContent=art.attribution??'Product packaging';wrapper.append(caption);});
    const progress=document.createElement('p');progress.className='notice';progress.setAttribute('role','status');wrapper.after(progress);
    const tear=$('tearPack');tear.disabled=true;
    let opening=false;
    const enable=()=>{if(opening)return;tear.disabled=false;wrapper.setAttribute('aria-disabled','false');};
    const skip=document.createElement('button');skip.className='quiet';skip.textContent='Continue while loading';tear.after(skip);skip.onclick=()=>{enable();skip.remove();};
    preparePack(pack.cards,status=>{if(!progress.isConnected)return;progress.textContent=`Preparing images: ${status.completed}/${status.total}${status.failed?' · some images unavailable':''}`;}).then(status=>{if(!tear.isConnected)return;enable();skip.remove();if(status.failed){const retry=document.createElement('button');retry.className='quiet';retry.textContent='Retry unavailable images';retry.onclick=()=>{retry.remove();preparePack(pack.cards);};progress.after(retry);}});
    const open=()=>safely(async()=>{
      if(opening||tear.disabled||!wrapper.isConnected||current!==pack)return;
      opening=true;tear.disabled=true;wrapper.setAttribute('aria-disabled','true');
      try{await unwrapPack({wrapper,stage,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,reveal:async()=>{
        const next=structuredClone(state);next.activeOpening={id:pack.id,index:0};await commit(next);current=pack;reveal=0;renderStage();
      }});stage.querySelector('.swipe-card')?.focus({preventScroll:true});}
      catch(error){opening=false;if(wrapper.isConnected)enable();throw error;}
    });
    tear.onclick=open;wrapper.onclick=open;
    wrapper.onkeydown=event=>{if(event.key==='Enter'||event.code==='Space'){event.preventDefault();event.stopPropagation();open();}};
    return;
  }
  if (reveal >= current.cards.length) {
    const total = current.cards.reduce((sum,item) => sum + (priceOf(item.card,item.finish) ?? 0),0);
    const known = current.cards.filter(item => priceOf(item.card,item.finish) !== null).length;
    stage.innerHTML = `<div class="summary"><div class="eyebrow">OPENING COMPLETE</div><h2>A new chapter in your collection.</h2><p class="notice">${current.cards.length} cards · Known value ${money(total)} (${known}/${current.cards.length} priced at opening)</p><div class="summary-cards">${current.cards.map(item => `<div>${img(item.card)}<span class="tag">${escape(item.finish)}</span></div>`).join('')}</div><button id="replayCurrent" class="secondary">Replay opening</button></div>`;
    $('replayCurrent').onclick = () => { reveal = -1; renderStage(); }; experience.decorate(); return;
  }
  const item = current.cards[reveal], card = item.card, price = priceOf(card, item.finish);
  stage.innerHTML = `<div class="stage-card"><div class="card-image ${item.finish !== 'nonfoil' ? 'foil' : ''}">${img(card, 'class="revealed"')}</div><div class="card-details"><div class="progress">CARD ${reveal + 1} / ${current.cards.length} · ${escape(item.slot)}</div><h3>${escape(card.name)}</h3><div><span class="tag">${escape(card.rarity)}</span><span class="tag">${escape(item.finish)}</span><span class="tag">${escape(card.set?.toUpperCase())} #${escape(card.collector_number)}</span><span class="tag">${escape(card.lang)}</span></div><div>${tags(card).map(tag => `<span class="tag">${escape(tag)}</span>`).join('')}</div><p class="price ${price >= 10 ? 'hit' : ''}">${price >= 10 ? '✦ Value hit · ' : ''}${money(price)}</p><p class="notice">USD estimate captured when this pack was opened.</p><div class="reveal-actions"><button id="nextCard" class="primary">${reveal + 1 === current.cards.length ? 'See results' : 'Set aside →'}</button><button id="revealAll" class="quiet">Reveal all</button>${card.backImage ? '<button id="flipCard" class="quiet">Other face</button>' : ''}</div></div></div><div class="reveal-strip">${current.cards.slice(0,reveal).map(item => img(item.card)).join('')}</div>`;
  $('nextCard').onclick = () => { reveal++; renderStage(); }; $('revealAll').onclick = () => { reveal = current.cards.length; renderStage(); };
  if ($('flipCard')) $('flipCard').onclick = () => { const element = stage.querySelector('.card-image img'); element.src = element.src === card.backImage ? card.image : card.backImage; };
  experience.decorate();
}
document.addEventListener('keydown', event => { if (event.code === 'Space' && !['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName) && $('openView').classList.contains('active')) { const next = $('tearPack') ?? $('nextCard'); if (next) { event.preventDefault(); next.click(); } } });

function renderAll() { $('totalOpened').textContent = state.history.length; renderCollection(); renderHistory(); renderBinders(); renderQueue(); experience.render(); renderNextOpening(); applyFoil(document,state.settings); }
function renderCollection() {
  const items = Object.entries(inventory(state.history)), query = $('collectionSearch').value.toLowerCase();
  for(const [,item] of items)if(metadata.has(item.card.id))item.card={...item.card,...metadata.get(item.card.id),prices:item.card.prices};
  updateFilters(items);
  const filters=Object.fromEntries(['set','rarity','finish','artist','location'].map(name=>[name,$(`filter-${name}`).value]));
  const count = items.reduce((sum,[,item]) => sum + item.quantity,0);
  const foil = items.filter(([,item]) => item.finish !== 'nonfoil').reduce((sum,[,item]) => sum + item.quantity,0);
  $('collectionStats').innerHTML = [[count,'total cards'],[new Set(items.map(([,i]) => i.card.id)).size,'distinct printings'],[foil,'foil / etched copies'],[state.history.length,'boosters opened']].map(([n,label]) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join('');
  const filtered=sortCollection(items.filter(([key,item])=>matchesCard(item,filters,state,key)&&`${item.card.name} ${item.card.set} ${tags(item.card).join(' ')}`.toLowerCase().includes(query)),$('collectionSort').value,$('collectionDirection').value);
  $('filterCount').textContent=`${filtered.length} / ${items.length} printing / finish entries`;
  $('collectionGrid').innerHTML = filtered.map(([key,item]) => `<article class="collection-card"><button class="quiet inspect-card" data-key="${escape(key)}" aria-label="View ${escape(item.card.name)}">${img(item.card,'loading="lazy"')}</button><div class="card-copy"><b>${escape(item.card.name)}</b><small>${escape(item.card.set?.toUpperCase())} #${escape(item.card.collector_number)} · ${escape(item.finish)} ×${item.quantity}</small><p class="price">${money(priceOf(item.card,item.finish))}</p><button class="quiet add-binder" data-key="${escape(key)}">Arrange in binder</button></div></article>`).join('') || '<p class="notice">No matching cards. Clear filters or open a booster.</p>';
  document.querySelectorAll('.inspect-card').forEach(button=>button.onclick=()=>{const item=items.find(([key])=>key===button.dataset.key)?.[1];if(item)viewCard(item.card,item.finish);});
  document.querySelectorAll('.add-binder').forEach(button => button.onclick = () => safely(async () => {
    document.dispatchEvent(new CustomEvent('select-binder-card',{detail:{key:button.dataset.key}}));showView('binders');
  }));
  renderLibraryProgress(items);
  $('collectionGrid').querySelectorAll('.inspect-card').forEach(button=>{button.querySelector('img').dataset.cardFinish=items.find(([key])=>key===button.dataset.key)[1].finish;});
  applyFoil($('collectionGrid'),state.settings);
}
$('collectionSearch').oninput = renderCollection;

function renderHistory() {
  $('historyList').innerHTML = state.history.map(pack => `<article class="history-item"><div class="history-header"><div><b>${escape(pack.setName)} · ${escape(pack.productName)}</b><p><small>${new Date(pack.date).toLocaleString()} · ${pack.cards.length} cards · MTGJSON model · Order unverified</small></p></div><div><button class="secondary replay" data-id="${escape(pack.id)}">Replay</button><button class="quiet danger delete-pack" data-id="${escape(pack.id)}">Delete</button></div></div><div class="history-cards">${pack.cards.map(item => img(item.card,'loading="lazy"')).join('')}</div></article>`).join('') || '<p class="notice">Your saved openings will appear here.</p>';
  document.querySelectorAll('.replay').forEach(button => button.onclick = () => { current = state.history.find(p => p.id === button.dataset.id); reveal = -1; renderStage(); showView('open'); });
  document.querySelectorAll('.delete-pack').forEach(button => button.onclick = () => safely(async () => {
    if (!confirm('Delete this opening and remove its cards from your collection? Binder copies exceeding the remaining inventory will be removed.')) return;
    const next = structuredClone(state); next.history = next.history.filter(p => p.id !== button.dataset.id); reconcileBinders(next); await commit(next);
    if (current?.id === button.dataset.id) { current = null; $('openingStage').innerHTML = '<p class="notice">Opening deleted.</p>'; }
  }));
}
function reconcileBinders(next) {
  const inv = inventory(next.history), used = {};
  for (const binder of next.binders) binder.slots = binder.slots.map(key => { if (!key) return null; used[key] = (used[key] ?? 0) + 1; return used[key] <= (inv[key]?.quantity ?? 0) ? key : null; });
  const valid = new Set(next.history.flatMap(pack=>pack.cards.map((_,index)=>`${pack.id}/${index}`)));
  next.decisions = Object.fromEntries(Object.entries(next.decisions ?? {}).filter(([id])=>valid.has(id)));
  if (!next.history.some(pack=>pack.id===next.activeOpening?.id)) delete next.activeOpening;
}
function renderBinders() {
  // One pointer-based workspace owns both browsing and arrangement now.
  $('bindersList').hidden=true;
}
$('newBinderButton').onclick = () => safely(async () => { const name = prompt('Binder name:', 'My binder'); if (!name?.trim()) return; const next = structuredClone(state); next.binders.push({ id: crypto.randomUUID(), name: name.trim(), slots: Array(18).fill(null) }); await commit(next); });
$('clearHistoryButton').onclick = () => safely(async () => { if (!confirm('Remove all openings and collected cards? Export a backup first. Binder slots will be emptied.')) return; const next = structuredClone(state); next.history = []; reconcileBinders(next); await commit(next); current = null; $('openingStage').innerHTML = '<p class="notice">Open a new booster to begin.</p>'; });

$('addQueue').onclick = () => safely(async () => {
  const group = $('groupSelect').value;
  if (!loaded || loaded.code !== $('setSelect').value) throw new Error('Load the selected set first.');
  const product = resolveProduct(loaded.configs, group, $('productSelect').value);
  const config = product.config;
  const price = $('groupPrice').value === '' ? null : Number($('groupPrice').value);
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('Enter a valid non-negative price.');
  const next = structuredClone(state), count = product.count;
  next.queue.push({ setCode: loaded.code, configKey: config.key, productKind: group, name: `${loaded.set.name} · ${product.label} · ${count} × ${config.name ?? config.key}`, count, originalCount: count, estimatedPrice: price });
  await commit(next);
});
function renderQueue() {
  $('queueList').innerHTML = state.queue.map((item,i) => `<div class="queue-row"><div class="queue-product-icon">${item.productKind === 'collector-display' ? '◆' : item.productKind === 'play-display' ? '▦' : '✦'}</div><div class="queue-copy"><b>${escape(item.name)}</b><p class="notice">${item.count} packs remaining · ${item.estimatedPrice == null ? 'No price set' : `${money(item.estimatedPrice)} estimated group price`} · ${['play-display','collector-display'].includes(item.productKind) ? 'Typical display size · set-specific exceptions may apply' : 'Pack group'}</p><div class="queue-progress" role="progressbar" aria-label="Packs opened" aria-valuenow="${queueProgress(item)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${queueProgress(item)}%"></span></div></div><button class="primary open-queued" data-index="${i}">Open next</button><button class="quiet remove-queued" data-index="${i}">Remove</button></div>`).join('') || '<p class="notice">Your queue is empty.</p>';
  document.querySelectorAll('.open-queued').forEach(button => button.onclick = () => safely(() => openPack(Number(button.dataset.index))));
  document.querySelectorAll('.remove-queued').forEach(button => button.onclick = () => safely(async () => { const next = structuredClone(state); next.queue.splice(Number(button.dataset.index),1); await commit(next); }));
}
$('exportButton').onclick = () => downloadBackup(state);
$('importInput').onchange = event => safely(async () => {
  const file = event.target.files[0]; if (!file) return;
  try { const next = validateBackup(JSON.parse(await file.text())); if (!confirm('Replace all local openings, binders and queued products with this backup?')) return; reconcileBinders(next); await commit(next); current = null; $('openingStage').innerHTML = '<p class="notice">Backup imported. Replay an opening from History.</p>'; toast('Backup restored.'); }
  finally { event.target.value = ''; }
});
async function init() {
  state = normalizeInteractions(await loadState()); renderAll(); $('addQueue').disabled = true;
  if (state.activeOpening) { current=state.history.find(pack=>pack.id===state.activeOpening.id); if(current){reveal=state.activeOpening.index;renderStage();} }
  await refreshCatalog();
}
async function refreshCatalog() {
  $('retryCatalog').disabled=true;$('setSelect').disabled=true;$('loadSetButton').disabled=true;
  $('setSelect').innerHTML='<option value="">Loading server catalog…</option>';
  try {
  sets = await getSets();
  renderSetOptions();
  $('catalogError').hidden=true;$('setSelect').disabled=false;$('loadSetButton').disabled=false;
  } catch(error) {
    $('setSelect').innerHTML='<option value="">Set catalog unavailable</option>';
    $('catalogErrorMessage').textContent=error.message;$('catalogError').hidden=false;
  } finally {$('retryCatalog').disabled=false;}
}
$('retryCatalog').onclick=refreshCatalog;
const availability=document.createElement('label');availability.innerHTML='<input id="showUnavailable" type="checkbox"> Show unavailable sets';$('sourceNote').before(availability);
$('showUnavailable').onchange=renderSetOptions;
function renderSetOptions(){
  const previous=$('setSelect').value, visible=sets.filter(s=>$('showUnavailable').checked||s.status==='ready');
  const labels={ready:'Ready',missing:'Not downloaded',unsupported:'No supported boosters',invalid:'Needs refresh'};
  $('setSelect').innerHTML='<option value="">Choose a ready set…</option>'+visible.map(s=>`<option value="${escape(s.code)}" ${s.status==='ready'?'':'disabled'}>${escape(s.name)} (${escape(s.code.toUpperCase())}) · ${labels[s.status]??'Restart server to update API'}</option>`).join('');
  if(visible.some(s=>s.code===previous&&s.status==='ready'))$('setSelect').value=previous;
  else $('setSelect').value=visible.find(s=>s.status==='ready')?.code??'';
  if(!visible.length)$('sourceNote').textContent='No ready sets. On the server run npm.cmd run refresh:set -- blb, then retry loading sets.';
}
const nextPanel=document.createElement('div');nextPanel.className='next-opening';
nextPanel.innerHTML='<button class="primary">Open next booster</button><span></span>';
const sortingNext=nextPanel.cloneNode(true);$('openingStage').after(nextPanel);$('bindersView').prepend(sortingNext);
function renderNextOpening(){
  const last=lastOpened??state?.history[0],queued=state?.queue[0],code=queued?.setCode??last?.setCode;
  for(const panel of [nextPanel,sortingNext]){panel.hidden=!code;panel.querySelector('button').disabled=busy||nextOpeningBusy;panel.querySelector('span').textContent=queued?`${queued.name} · ${queued.count} remaining`:`${code?.toUpperCase()??''} · ${last?.configKey??''} · Queue empty — same product`;}
  nextPanel.hidden=!code||Boolean(current&&reveal<current.cards.length);
}
async function openNext(){
  if(busy||nextOpeningBusy)return;nextOpeningBusy=true;
  for(const panel of [nextPanel,sortingNext])panel.querySelector('button').disabled=true;
  try{
    if(state.queue.length)await openPack(0);
    else{const last=lastOpened??state.history[0];if(!last)throw new Error('Open a booster first.');if(loaded?.code!==last.setCode)await selectSet(last.setCode);if(!loaded.configs.some(c=>c.key===last.configKey&&c.available))throw new Error('Previous product unavailable. Choose another product; it will not be substituted automatically.');$('productSelect').value=last.configKey;await openPack();}
  }finally{nextOpeningBusy=false;renderNextOpening();}
}
for(const panel of [nextPanel,sortingNext])panel.querySelector('button').onclick=()=>safely(openNext);
const filterPanel=document.createElement('details');filterPanel.innerHTML='<summary>Filters</summary><div class="collection-filters">'+['set','rarity','finish','artist','location'].map(n=>`<label>${n}<select id="filter-${n}"><option value="">All</option></select></label>`).join('')+'<button id="clearFilters" class="quiet">Clear filters</button></div><p id="filterCount" role="status"></p>';$('collectionStats').after(filterPanel);
function updateFilters(items){
  for(const name of ['set','rarity','finish','artist','location']){
    const select=$(`filter-${name}`),value=select.value;
    const values=name==='location'?['binder','unassigned','pending']:[...new Set(items.flatMap(([,i])=>name==='artist'?artists(i.card):[name==='finish'?i.finish:i.card[name]]).filter(Boolean))].sort();
    select.innerHTML='<option value="">All</option>'+values.map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('');select.value=values.includes(value)?value:'';
  }
}
filterPanel.onchange=renderCollection;$('clearFilters').onclick=()=>{filterPanel.querySelectorAll('select').forEach(s=>s.value='');$('collectionSearch').value='';renderCollection();};
const sortPanel=document.createElement('div');sortPanel.className='collection-filters';
sortPanel.innerHTML='<label>Sort by<select id="collectionSort"><option value="number">Set → collector number</option><option value="name">Card name</option></select></label><label>Direction<select id="collectionDirection"><option value="asc">Ascending · A–Z / 1–9</option><option value="desc">Descending · Z–A / 9–1</option></select></label>';
filterPanel.after(sortPanel);sortPanel.onchange=renderCollection;
let fetchingChecklists=false;
async function loadChecklists(){
  if(fetchingChecklists)return;fetchingChecklists=true;
  try{for(const code of new Set(Object.values(inventory(state.history)).map(i=>i.card.set))){if(checklists.has(code))continue;try{const data=await request(`/api/sets/${encodeURIComponent(code)}/checklist`);checklists.set(code,data);for(const card of data.checklist??[])metadata.set(card.id,card);}catch(error){console.warn(code,error.message);}}renderCollection();}finally{fetchingChecklists=false;}
}
function renderLibraryProgress(items){
  const root=$('setProgress');root.innerHTML='<h3>Set progress</h3><p>English printings · any finish counts once. Base pool is estimated from treatment metadata; bonus sheets, tokens and other set codes are separate.</p>';
  for(const code of new Set([...items.map(([,i])=>i.card.set),...(loaded?[loaded.code]:[])])){
    const data=checklists.get(code),cards=data?.checklist,owned=items.filter(([,i])=>i.card.set===code).map(([,i])=>i.card);
    const section=document.createElement('section');section.className='library-progress';const title=document.createElement('h4');title.textContent=code.toUpperCase();section.append(title);
    if(!cards){const button=document.createElement('button');button.textContent='Load checklist from server';button.onclick=()=>safely(async()=>{const data=await request(`/api/sets/${code}/checklist`);checklists.set(code,data);for(const card of data.checklist??[])metadata.set(card.id,card);renderCollection();});section.append(button);}
    else for(const mode of ['base','all']){const progress=setProgress(cards,owned,mode),p=document.createElement('p');p.textContent=`${mode==='base'?'Base identities (estimated)':'All printings'}: ${progress.collected} / ${progress.total} · ${progress.total?(100*progress.collected/progress.total).toFixed(1):0}%`;const bar=document.createElement('progress');bar.max=progress.total||1;bar.value=progress.collected;section.append(p,bar);const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Missing cards (${progress.missing.length} printings)`;details.append(summary);for(const card of progress.missing){const button=document.createElement('button');button.className='quiet';button.textContent=`${card.name} #${card.collector_number}`;button.onclick=()=>viewCard(card);details.append(button);}section.append(details);}
    root.append(section);
  }
}
const undoRemoval=document.createElement('button');undoRemoval.className='quiet';undoRemoval.textContent='Undo removal';$('newBinderButton').before(undoRemoval);
undoRemoval.onclick=()=>safely(async()=>{if(!removedCard)return;const {source,key}=removedCard,next=structuredClone(state),binder=next.binders.find(b=>b.id===source.id);if(!binder||binder.slots[source.position])throw new Error('Original pocket is no longer available.');const used=next.binders.flatMap(b=>b.slots).filter(k=>k===key).length;if(used>=(inventory(next.history)[key]?.quantity??0))throw new Error('No unassigned copy remains.');binder.slots[source.position]=key;await commit(next);removedCard=null;});
document.addEventListener('click',event=>{
  if(event.target.closest('dialog'))return;
  const img=event.target.closest('.history-cards img,.summary-cards img,.reveal-strip img');if(!img)return;
  const item=state?.history.flatMap(p=>p.cards).find(i=>i.card.image===img.getAttribute('src'));if(item)viewCard({...item.card,...metadata.get(item.card.id),prices:item.card.prices},item.finish);
});
safely(init);