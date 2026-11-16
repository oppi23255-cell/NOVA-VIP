export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatArabicDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function normalizeDomainClient(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
}

export function buildLiveUrl(origin: string, customDomain: string): string {
  const browserOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : origin;
  const cleanOrigin = browserOrigin.replace(/\/+$/, '');
  return `${cleanOrigin}/sites/${encodeURIComponent(customDomain)}/`;
}
