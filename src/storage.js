import { foilPreset } from './pack-opening.js';
export const freshState = () => ({ schemaVersion: 2, history: [], binders: [], queue: [], settings: {binderSide:'right',foilPreset:'sheen',foilIntensity:'medium'}, decisions: {} });
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('booster-vault', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('state'); request.result.createObjectStore('cache'); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function read(store, key) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function write(store, key, value) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function loadState() { return await read('state', 'main') ?? freshState(); }
export async function saveState(state) { await write('state', 'main', state); }
export function validateBackup(value) {
  if (![1,2].includes(value?.schemaVersion) || !Array.isArray(value.history) || !Array.isArray(value.binders) || !Array.isArray(value.queue)) throw new Error('Unsupported backup format.');
  const ids = new Set();
  for (const pack of value.history) {
    if (typeof pack.id !== 'string' || ids.has(pack.id) || !Array.isArray(pack.cards) || !Number.isFinite(Date.parse(pack.date)) || typeof pack.setName !== 'string' || typeof pack.productName !== 'string') throw new Error('Invalid opening record.');
    ids.add(pack.id);
    for (const item of pack.cards) if (typeof item.card?.id !== 'string' || typeof item.card?.name !== 'string' || !['nonfoil','foil','etched'].includes(item.finish)) throw new Error('Invalid card record.');
  }
  for (const binder of value.binders) if (typeof binder.id !== 'string' || typeof binder.name !== 'string' || !Array.isArray(binder.slots) || binder.slots.some(slot => slot !== null && typeof slot !== 'string')) throw new Error('Invalid binder record.');
  for (const entry of value.queue) if (typeof entry.setCode !== 'string' || typeof entry.configKey !== 'string' || typeof entry.name !== 'string' || !Number.isInteger(entry.count) || entry.count < 1 || entry.count > 1000) throw new Error('Invalid queued product.');
  const decisions = {};
  for (const pack of value.history) for (let i=0;i<pack.cards.length;i++) {
    const id=`${pack.id}/${i}`, decision=value.decisions?.[id];
    if (['collection','binder','placed'].includes(decision)) decisions[id]=decision;
  }
  const active=value.activeOpening, pack=value.history.find(p=>p.id===active?.id);
  const legacyIntensity={normal:'medium'};
  const effectSettings={effects:['full','subtle','off'].includes(value.settings?.effects)?value.settings.effects:'full',foilMotion:value.settings?.foilMotion!==false,foilPreset:['prism','sheen','holographic'].includes(value.settings?.foilPreset)?value.settings.foilPreset:'sheen',foilIntensity:['low','medium','high'].includes(value.settings?.foilIntensity)?value.settings.foilIntensity:(legacyIntensity[value.settings?.foilIntensity]??'medium')};
  effectSettings.foilPreset=foilPreset(value.settings?.foilPreset);
  return { schemaVersion: 2, history: value.history, binders: value.binders, queue: value.queue, settings:{binderSide:value.settings?.binderSide==='left'?'left':'right',...effectSettings}, decisions, ...(pack && Number.isInteger(active.index) && active.index>=-1 && active.index<=pack.cards.length ? {activeOpening:active}: {}) };
}
export function downloadBackup(state) {
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `booster-vault-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}