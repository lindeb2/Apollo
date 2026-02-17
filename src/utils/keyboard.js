function isApplePlatform() {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isPrimaryModifierPressed(event) {
  if (!event) return false;
  return isApplePlatform() ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
}

