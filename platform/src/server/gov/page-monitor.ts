/**
 * Page monitor normalisation (Phase 7). For sources that offer no API or feed we only need to know that a page changed in a
 * way a person should look at. The page is reduced to its readable text plus the sorted set of https links it contains
 * (links to forms and guideline files are where real changes often hide). Scripts, styles, navigation and footers are dropped
 * so tracking code, menus and rotating banners do not create false alarms. Nothing here is ever turned into a programme.
 *
 * Elements are removed with a linear scan (indexOf), not a backtracking regular expression, so a hostile page cannot stall the worker.
 */

const DROP = ['script', 'style', 'noscript', 'svg', 'template', 'nav', 'footer', 'header', 'form', 'iframe'];
const BLOCK_END = /<\/(?:p|div|li|tr|td|th|h[1-6]|section|article|ul|ol|table|blockquote|dd|dt)>|<br\s*\/?>/gi;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export const MAX_LINKS = 300;

function removeComments(html: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const start = html.indexOf('<!--', i);
    if (start < 0) return out + html.slice(i);
    out += html.slice(i, start);
    const end = html.indexOf('-->', start + 4);
    if (end < 0) return out;
    i = end + 3;
  }
}

function removeElements(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let out = '';
  let i = 0;
  for (;;) {
    let start = lower.indexOf(open, i);
    // `<nav` must not match `<navigation-x`: the next character has to end the tag name.
    while (start >= 0 && !/[\s>/]/.test(lower[start + open.length] ?? '')) start = lower.indexOf(open, start + open.length);
    if (start < 0) return out + html.slice(i);
    out += html.slice(i, start);
    const closeAt = lower.indexOf(close, start + open.length);
    if (closeAt < 0) return out; // unterminated: drop the rest
    const gt = lower.indexOf('>', closeAt);
    i = gt < 0 ? html.length : gt + 1;
  }
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** https links found in the page, resolved against its address, without fragments, sorted and de-duplicated. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const re = /<a\s[^>]{0,2000}?href\s*=\s*(?:"([^"]{1,2000})"|'([^']{1,2000})')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && found.size < MAX_LINKS * 2) {
    const raw = decode(m[1] ?? m[2] ?? '').trim();
    if (!raw || raw.startsWith('#')) continue;
    try {
      const u = new URL(raw, baseUrl);
      if (u.protocol !== 'https:') continue;
      u.hash = '';
      found.add(u.toString());
    } catch {
      /* not a URL */
    }
  }
  return [...found].sort().slice(0, MAX_LINKS);
}

export interface NormalizedPage {
  /** Readable text, one block per line. */
  text: string;
  links: string[];
  /** What is hashed and stored as evidence: text, then the links. */
  normalized: string;
}

export function normalizePage(html: string, baseUrl: string): NormalizedPage {
  // Links are read from the whole page (menus can hold the only link to a form), the text from the content area only.
  const links = extractLinks(removeComments(html), baseUrl);
  let body = removeComments(html);
  for (const tag of DROP) body = removeElements(body, tag);
  body = body.replace(BLOCK_END, '\n').replace(/<[^>]{0,2000}>/g, ' ');
  const decoded = decode(body);
  const printable = Array.from(decoded, (ch) => {
    const c = ch.charCodeAt(0);
    return (c < 32 && c !== 10) || c === 127 ? ' ' : ch;
  }).join('');
  const text = printable
    .split(/\n/)
    .map((l) => l.replace(/[ \t ​]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  const normalized = links.length ? `${text}\n\n--- links ---\n${links.join('\n')}` : text;
  return { text, links, normalized };
}

/** A short line-based comparison for the review screen: lines only in the old text, lines only in the new text. */
export function lineDiff(oldText: string, newText: string, max = 200): { removed: string[]; added: string[] } {
  const a = oldText.split('\n').map((l) => l.trim()).filter(Boolean);
  const b = newText.split('\n').map((l) => l.trim()).filter(Boolean);
  const inA = new Set(a);
  const inB = new Set(b);
  return {
    removed: a.filter((l) => !inB.has(l)).slice(0, max),
    added: b.filter((l) => !inA.has(l)).slice(0, max),
  };
}
