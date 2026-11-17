import site from '../../content/site.json';
import { getMedia, url } from './media';

export type Part = { src: string; poster?: string; alt: string; w: number; h: number };

/** Resolve media ids to playable video parts, skipping any whose file isn't in public/. */
export const videoParts = (ids: readonly string[], fallback = { w: 1280, h: 720 }): Part[] =>
  ids
    .map((id) => getMedia(id))
    .filter((m) => m.available && m.item)
    .map((m) => ({
      src: url(m.item!.file!),
      poster: m.hasPoster && m.item!.poster ? url(m.item!.poster) : undefined,
      alt: m.item!.alt,
      w: m.item!.w ?? fallback.w,
      h: m.item!.h ?? fallback.h,
    }));

/** Interview films whose file exists in public/. */
export const readyInterviews = site.interviews.items.filter((i) => getMedia(i.media).available);

/** Interview series (vertical episodes): only parts with a file; a series with none is dropped. */
export const readySeries = site.interviews.series
  .map((s) => ({ ...s, parts: videoParts(s.parts, { w: 540, h: 960 }) }))
  .filter((s) => s.parts.length > 0);

/** With no films and no series, the section and its nav link are hidden. */
export const showInterviews = readyInterviews.length > 0 || readySeries.length > 0;

/** Nav links, minus sections that are currently hidden. */
const hidden = new Set([!showInterviews && '#interviews'].filter(Boolean));
export const navLinks = site.nav.filter((n) => !hidden.has(n.href));

/** Links into the platform. Absolute URLs: they must never take part in the in-page scroll spy (no data-spy). */
export const appLinks = site.app.links.map((l) => ({ label: l.label, href: `${site.app.origin}${l.path}`, cta: Boolean((l as { cta?: boolean }).cta) }));

/** "Get started" section: cards that open the platform. */
export const getStarted = {
  heading: site.getStarted.heading,
  body: site.getStarted.body,
  cards: site.getStarted.cards.map((c) => ({ ...c, href: `${site.app.origin}${c.path}` })),
};
