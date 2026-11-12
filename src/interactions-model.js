import { inventory, cardKey } from './simulator.js';

export function valueTier(price) {
  const level = Number.isFinite(price) ? [2, 5, 15, 50, 100].filter(n => price >= n).length : 0;
  return { level, label: ['', 'Nice find', 'Great pull', 'Premium pull', 'Treasure', 'Jackpot'][level] };
}
export function normalizeInteractions(state) {
  state.schemaVersion = 2;
  state.settings = { binderSide: 'right', ...state.settings };
  state.decisions ??= {};
  return state;
}
export function availableCopies(state, key) {
  return (inventory(state.history)[key]?.quantity ?? 0) - state.binders.flatMap(b => b.slots).filter(slot => slot === key).length;
}
export function binderLocations(state, key) {
  const separator=key.lastIndexOf(':');
  const printing=key.slice(0,separator);
  return state.binders.flatMap(binder=>binder.slots.flatMap((slot,index)=>{
    if(!slot || slot.slice(0,slot.lastIndexOf(':'))!==printing)return [];
    return [{binderId:binder.id,name:binder.name,slot:index+1,finish:slot.slice(slot.lastIndexOf(':')+1),exact:slot===key}];
  }));
}
export function pendingCards(state) {
  const remaining = {};
  const result = [];
  for (const pack of state.history) for (const [index, item] of pack.cards.entries()) {
    const id = `${pack.id}/${index}`, key = cardKey(item.card, item.finish);
    if (state.decisions?.[id] !== 'binder') continue;
    remaining[key] ??= Math.max(0, availableCopies(state, key));
    if (remaining[key]-- > 0) result.push({ id, key, ...item });
  }
  return result;
}
export function placeCard(state, key, binderId, position, source = null, pendingId = null) {
  const next = structuredClone(state);
  const target = next.binders.find(b => b.id === binderId);
  if (!target || !Number.isInteger(position) || position < 0 || position >= target.slots.length) throw new Error('Invalid pocket.');
  if (source) {
    const from = next.binders.find(b => b.id === source.id);
    if (!from || from.slots[source.position] !== key) throw new Error('The source card has moved.');
    [from.slots[source.position], target.slots[position]] = [target.slots[position], key];
  } else {
    if (target.slots[position]) throw new Error('Choose an empty pocket.');
    if (availableCopies(state, key) < 1) throw new Error('All copies are already in binders.');
    target.slots[position] = key;
    const pending = pendingId ?? pendingCards(state).find(item => item.key === key)?.id;
    if (pending) { next.decisions ??= {}; next.decisions[pending] = 'placed'; }
  }
  return next;
}
export function swipeAction(dx, dy, width, binderSide = 'right') {
  if (Math.abs(dx) < Math.min(100, width * .28) || Math.abs(dy) > Math.abs(dx) * 1.3) return null;
  return (dx > 0 ? 'right' : 'left') === binderSide ? 'binder' : 'collection';
}