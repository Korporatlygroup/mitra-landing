/** Public contact links on a business page. The database validates and normalises them when they are saved; this is the render-time guard. */
export const LINK_KINDS = ['website', 'facebook', 'instagram', 'tiktok', 'linkedin', 'youtube', 'google_maps'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type ListingLinks = Partial<Record<LinkKind | 'whatsapp', string>>;

const HOSTS: Record<Exclude<LinkKind, 'website' | 'google_maps'>, RegExp> = {
  facebook: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/,
  instagram: /(^|\.)instagram\.com$/,
  tiktok: /(^|\.)tiktok\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/,
};

/** Returns the URL only if it is a plain https link to an allowed host for that kind; otherwise null (nothing is rendered). */
export function safeLinkHref(kind: LinkKind, value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^[0-9.]+$/.test(host)) return null;
  if (kind === 'website') {
    if (/\.(local|internal|test|localhost|invalid|example)$/.test(host)) return null;
  } else if (kind === 'google_maps') {
    const ok =
      /^(maps\.app\.goo\.gl|g\.page)$/.test(host) ||
      (/(^|\.)google\.com(\.my)?$/.test(host) && (host.startsWith('maps.') || u.pathname.toLowerCase().startsWith('/maps'))) ||
      (host === 'goo.gl' && u.pathname.toLowerCase().startsWith('/maps'));
    if (!ok) return null;
  } else if (!HOSTS[kind].test(host)) {
    return null;
  }
  return u.href;
}

/** wa.me link for a stored +<digits> number (8 to 15 digits), or null. */
export function whatsappHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^\+([0-9]{8,15})$/.exec(value);
  return m ? `https://wa.me/${m[1]}` : null;
}
