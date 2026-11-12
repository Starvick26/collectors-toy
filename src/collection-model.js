export function artists(card) { return [...new Set([card.artist, ...(card.artists ?? [])].filter(Boolean))]; }
const naturalOrder = new Intl.Collator('en', { numeric:true, sensitivity:'base' });
export function sortCollection(entries, field = 'number', direction = 'asc') {
  const compare = (a,b) => naturalOrder.compare(String(a ?? ''), String(b ?? ''));
  const sign = direction === 'desc' ? -1 : 1;
  return [...entries].sort(([keyA,a],[keyB,b]) => {
    // Unknown numbers/names stay at the end in either direction.
    const valueA = field === 'name' ? a.card.name : a.card.collector_number;
    const valueB = field === 'name' ? b.card.name : b.card.collector_number;
    const missingA = valueA == null || valueA === '', missingB = valueB == null || valueB === '';
    if (missingA !== missingB) return missingA ? 1 : -1;
    const primary = field === 'name' ? compare(valueA,valueB)
      : compare(a.card.set,b.card.set) || compare(valueA,valueB);
    return sign * (primary || compare(a.card.name,b.card.name) || compare(a.card.set,b.card.set)
      || compare(a.card.collector_number,b.card.collector_number) || compare(a.finish,b.finish) || compare(keyA,keyB));
  });
}
export function matchesCard(item, filters, state, key) {
  const {card, finish} = item;
  const placed = state.binders.some(b => b.slots.includes(key));
  const pending = state.history.some(p => p.cards.some((i,n) => `${i.card.id}:${i.finish}` === key && state.decisions?.[`${p.id}/${n}`] === 'binder'));
  return (!filters.set || card.set === filters.set) && (!filters.rarity || card.rarity === filters.rarity)
    && (!filters.finish || finish === filters.finish) && (!filters.artist || artists(card).includes(filters.artist))
    && (!filters.location || (filters.location === 'binder' ? placed : filters.location === 'pending' ? pending : !placed));
}
export function setProgress(cards, owned, mode = 'all') {
  const pool = cards.filter(c => mode !== 'base' || c.base);
  const identity = c => mode === 'base' ? (c.oracle_id ?? c.id) : c.id;
  const total = new Set(pool.map(identity)), acquired = new Set(owned.map(identity));
  return { total: total.size, collected: [...total].filter(id => acquired.has(id)).length, missing: pool.filter(c => !acquired.has(identity(c))) };
}