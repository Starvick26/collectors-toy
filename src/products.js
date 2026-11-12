export const groups = {
  single: { count: 1, label: 'Single booster' },
  prerelease: { count: 6, type: 'play', label: 'Prerelease-style pack group' },
  bundle: { count: 9, type: 'play', label: 'Bundle-style pack group' },
  'play-display': { count: 30, type: 'play', label: 'Play Booster Display' },
  'collector-display': { count: 12, type: 'collector', label: 'Collector Booster Display' },
  'custom-36': { count: 36, label: 'Custom group' }
};
export function resolveProduct(configs, groupKey, selectedKey) {
  const group = groups[groupKey];
  if (!group) throw new Error('Unknown product group.');
  // Do not substitute a Collector Sample pack, Arena configuration or other
  // arbitrary available product when the required full-size booster is absent.
  const key = group.type ?? selectedKey;
  const config = configs.find(config => config.key === key && config.available);
  if (!config) throw new Error(`This set has no available ${group.type ?? 'selected'} booster configuration. Choose a different product or set.`);
  return { ...group, config };
}
export function queueProgress(item) {
  if (!Number.isFinite(item.originalCount) || item.originalCount <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - item.count / item.originalCount) * 100));
}