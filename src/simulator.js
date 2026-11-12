export function weightedPick(items, random = Math.random) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight ?? 1), 0);
  if (!total) throw new Error('No positive-weight candidates.');
  let roll = random() * total;
  return items.find(item => (roll -= Math.max(0, item.weight ?? 1)) < 0) ?? items.at(-1);
}
// Sheet composition is modeled; physical reveal order is unverified unless a profile is supplied.
export function simulatePack(config, cardIndex, random = Math.random, orderProfile = null) {
  const pack = weightedPick(config.boosters, random);
  const output = [];
  for (const [slot, count] of Object.entries(pack.contents)) {
    const sheet = config.sheets[slot];
    if (!sheet || !Number.isInteger(count) || count < 0) throw new Error(`Invalid sheet: ${slot}`);
    let candidates = Object.entries(sheet.cards).map(([uuid, weight]) => ({ uuid, weight }));
    if (sheet.fixed && candidates.length !== count) throw new Error(`Unsupported fixed sheet: ${slot}`);
    for (let i = 0; i < count; i++) {
      const chosen = sheet.fixed ? candidates[i] : weightedPick(candidates, random);
      const card = cardIndex[chosen.uuid];
      if (!card) throw new Error(`Unresolved card in ${slot}. Reload the set.`);
      const finish = sheet.foil ? (card.finishes?.includes('foil') ? 'foil' : card.finishes?.includes('etched') ? 'etched' : null) : 'nonfoil';
      if (!finish || !card.finishes?.includes(finish)) throw new Error(`Finish cannot be resolved for ${card.name} in ${slot}.`);
      output.push({ card, finish, slot });
      if (!sheet.fixed && !sheet.allowDuplicates) candidates = candidates.filter(item => item.uuid !== chosen.uuid);
    }
  }
  if (!output.length) throw new Error('This configuration contains no cards.');
  if (orderProfile) output.sort((a,b) => orderProfile.indexOf(a.slot) - orderProfile.indexOf(b.slot));
  return { cards: output, confidence: 'MTGJSON model', source: 'MTGJSON booster sheets', orderVerified: Boolean(orderProfile), colorApproximation: Object.values(config.sheets).some(sheet => sheet.balanceColors) };
}
export function cardKey(card, finish) { return `${card.id}:${finish}`; }
export function priceOf(card, finish) {
  const value = card.prices?.[finish === 'etched' ? 'usd_etched' : finish === 'foil' ? 'usd_foil' : 'usd'];
  return value == null ? null : Number(value);
}
export function inventory(history) {
  const result = {};
  for (const pack of history) for (const item of pack.cards) {
    const key = cardKey(item.card, item.finish);
    result[key] ??= { ...item, quantity: 0 };
    result[key].quantity++;
  }
  return result;
}