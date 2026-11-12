/**
 * TEKUN Nasional scheme extractor (Phase 7, source adapter `tekun`).
 * Deterministic: reads the server-rendered scheme page and its "Syarat-syarat" (conditions) page. Nothing is inferred:
 * a value that is not on the page stays absent, every eligibility line is kept as a quoted rule (unrecognised lines
 * become `note` rules that need agency assessment), and anything uncertain is flagged for the reviewer.
 * The page text is untrusted data: it is only ever read with fixed patterns, never executed or followed as instructions.
 */

export interface TekunRule {
  field: string;
  op: 'eq' | 'in' | 'gte' | 'lte' | 'note';
  value?: string | number;
  quote: string;
}

export interface TekunCandidate {
  name: string;
  description?: string;
  funding_type?: 'financing';
  amount_min?: string;
  amount_max?: string;
  currency?: 'MYR';
  application_channel?: 'online' | 'branch' | 'form' | 'enquiry' | 'unknown';
  application_url?: string;
  info_url: string;
  application_status: 'unknown';
  documents?: string[];
  terms?: { label: string; text: string }[];
  rules: TekunRule[];
  review_notes?: string[];
  extraction_status: 'complete' | 'partial';
}

export class ExtractionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ExtractionError';
  }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&nbsp;': ' ', '&ndash;': '–', '&#8211;': '–', '&#8217;': '’' };

function decode(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|nbsp|ndash|#039|#8211|#8217);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));
}

function stripTags(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<(?:\/?)(?:h[1-6]|p|li|tr|div|br|ul|ol|table|section)\b[^>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);
}

const FOOTER = /Ibu Pejabat TEKUN|Tarikh Dikemaskini/;

function mainText(html: string): string[] {
  const i = html.search(/<h1[\s>]/i);
  if (i < 0) throw new ExtractionError('no_h1');
  const all = lines(stripTags(html.slice(i)));
  const end = all.findIndex((l) => FOOTER.test(l));
  return end >= 0 ? all.slice(0, end) : all;
}

export function schemeName(html: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) throw new ExtractionError('no_h1');
  return decode(m[1]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** The "Syarat-syarat" button on a scheme page: the first link after that heading. Re-validated by the caller. */
export function findConditionsLink(schemeHtml: string, baseUrl: string): string | null {
  const m = /<h5[^>]*>\s*Syarat-syarat\s*<\/h5>[\s\S]{0,1200}?href="([^"]+)"/i.exec(schemeHtml);
  if (!m) return null;
  try {
    return new URL(decode(m[1]!), baseUrl).toString();
  } catch {
    return null;
  }
}

interface Section {
  title: string;
  body: string[];
}

function accordionSections(html: string): Section[] {
  const parts = html.split(/<h3 class="bde-accordion__title-tag"/i).slice(1);
  return parts.map((part) => {
    const title = /<span class="bde-accordion__title"[^>]*>([\s\S]*?)<\/span>/i.exec(part);
    const afterTitle = part.slice(part.indexOf('</h3>') + 5);
    const body = lines(stripTags(afterTitle));
    const end = body.findIndex((l) => FOOTER.test(l));
    return { title: decode((title?.[1] ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(), body: end >= 0 ? body.slice(0, end) : body };
  });
}

function section(sections: Section[], startsWith: string): Section | undefined {
  return sections.find((s) => s.title.toLowerCase().startsWith(startsWith.toLowerCase()));
}

const num = (s: string) => s.replace(/,/g, '');

function parseRules(items: string[]): TekunRule[] {
  const rules: TekunRule[] = [];
  for (const raw of items) {
    const quote = raw.slice(0, 590);
    let matched = false;
    if (/Masyarakat India/i.test(raw) && /Warganegara Malaysia/i.test(raw)) {
      rules.push({ field: 'community', op: 'eq', value: 'indian', quote }, { field: 'citizenship', op: 'eq', value: 'malaysian', quote });
      matched = true;
    }
    const age = /Berumur\s+(\d{1,2})\s*[–-]\s*(\d{1,2})\s*tahun/i.exec(raw);
    if (age) {
      rules.push({ field: 'age_min', op: 'gte', value: Number(age[1]), quote }, { field: 'age_max', op: 'lte', value: Number(age[2]), quote });
      matched = true;
    }
    if (/Lesen\s*\/\s*Permit|Daftar Perniagaan/i.test(raw)) {
      rules.push({ field: 'registration', op: 'eq', value: 'licensed_or_registered', quote });
      matched = true;
    }
    // Everything else, and the 100%-ownership / paid-up capital / bankruptcy lines, stays as a quoted note.
    if (!matched || /100%|modal berbayar|muflis/i.test(raw)) rules.push({ field: 'note', op: 'note', quote });
  }
  return rules.slice(0, 40);
}

export interface TekunInput {
  schemeHtml: string;
  schemeUrl: string;
  conditionsHtml: string | null;
}

export interface TekunResult {
  candidate: TekunCandidate;
  externalKey: string;
  evidence: string;
}

export function externalKeyFor(schemeUrl: string): string {
  const path = new URL(schemeUrl).pathname.replace(/\/+$/, '');
  const key = path.split('/').pop() ?? '';
  if (!/^[a-z0-9-]{3,120}$/.test(key)) throw new ExtractionError('bad_key');
  return key;
}

export function extractTekunScheme(input: TekunInput): TekunResult {
  const name = schemeName(input.schemeHtml);
  const externalKey = externalKeyFor(input.schemeUrl);
  const review: string[] = [];
  const candidate: TekunCandidate = {
    name,
    info_url: input.schemeUrl,
    application_status: 'unknown',
    rules: [],
    extraction_status: 'partial',
  };
  const evidenceLines: string[] = [`# ${name}`, ...mainText(input.schemeHtml).slice(0, 40)];

  if (input.conditionsHtml) {
    const sections = accordionSections(input.conditionsHtml);
    if (sections.length === 0) throw new ExtractionError('no_sections');
    for (const s of sections) evidenceLines.push(`## ${s.title}`, ...s.body.slice(0, 60));

    const objective = section(sections, 'Objektif');
    if (objective?.body.length) candidate.description = objective.body.join(' ').slice(0, 3900);

    const amount = section(sections, 'Jumlah pembiayaan');
    const text = amount?.body.join(' ') ?? '';
    const range = /RM\s?([\d,]+(?:\.\d{1,2})?)\s*[–-]\s*RM\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
    if (range) {
      candidate.amount_min = num(range[1]!);
      candidate.amount_max = num(range[2]!);
      candidate.currency = 'MYR';
      candidate.funding_type = 'financing';
    } else {
      review.push('The financing amount could not be read from the page; check it on the official page.');
    }

    const terms: { label: string; text: string }[] = [];
    for (const [label, key] of [['Tempoh pembiayaan', 'Tempoh pembiayaan'], ['Kadar keuntungan', 'Kadar keuntungan'], ['Simpanan', 'Simpanan']] as const) {
      const s = section(sections, key);
      if (s?.body.length) terms.push({ label, text: s.body.join(' ').slice(0, 600) });
    }
    if (terms.length) candidate.terms = terms;

    const eligibility = section(sections, 'Syarat kelayakan');
    if (eligibility) candidate.rules = parseRules(eligibility.body);
    else review.push('No eligibility section was found.');

    const docs = section(sections, 'Dokumen asas');
    if (docs) {
      const items = docs.body.filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').slice(0, 300));
      if (items.length) candidate.documents = items.slice(0, 20);
    }

    const how = section(sections, 'Cara permohonan');
    const howText = how?.body.join(' ') ?? '';
    if (/Pejabat Cawangan/i.test(howText)) {
      candidate.application_channel = 'branch';
    } else if (/atas talian|TEKUN Online/i.test(howText)) {
      candidate.application_channel = 'online';
      if (/tekunonline\.tekun\.gov\.my\/login/.test(input.conditionsHtml)) candidate.application_url = 'https://tekunonline.tekun.gov.my/login';
    } else {
      candidate.application_channel = 'unknown';
      review.push('How to apply was not stated on the conditions page.');
    }
    if (/subject to change|tertakluk kepada perubahan/i.test(howText)) review.push('The page says the application method is subject to current changes.');
    if (candidate.application_channel === 'branch' && /tekunonline\.tekun\.gov\.my/.test(input.schemeHtml)) {
      review.push('The site menu mentions online applications (TEKUN Online) while this scheme page says applications are made at a branch. Confirm the current channel with TEKUN before publishing.');
    }
  } else {
    review.push('The conditions page could not be read.');
  }

  review.push('Application status (open or closed) is not stated for this scheme; it is left as unknown.');
  candidate.review_notes = review.slice(0, 5);
  const complete = Boolean(candidate.amount_max && candidate.rules.length > 0 && candidate.application_channel && candidate.application_channel !== 'unknown');
  candidate.extraction_status = complete ? 'complete' : 'partial';
  return { candidate, externalKey, evidence: evidenceLines.join('\n').slice(0, 19500) };
}
