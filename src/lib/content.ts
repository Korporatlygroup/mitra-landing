import site from '../../content/site.json';
import { getMedia, url } from './media';

/** Interview films whose file exists in public/. */
export const readyInterviews = site.interviews.items.filter((i) => getMedia(i.media).available);

/** Interview series (vertical episodes): only parts with a file; a series with none is dropped. */
export const readySeries = site.interviews.series
  .map((s) => ({
    ...s,
    parts: s.parts
      .map((id) => getMedia(id))
      .filter((m) => m.available && m.item)
      .map((m) => ({
        src: url(m.item!.file!),
        poster: m.hasPoster && m.item!.poster ? url(m.item!.poster) : undefined,
        alt: m.item!.alt,
        w: m.item!.w ?? 540,
        h: m.item!.h ?? 960,
      })),
  }))
  .filter((s) => s.parts.length > 0);

/** With no films and no series, the section and its nav link are hidden. */
export const showInterviews = readyInterviews.length > 0 || readySeries.length > 0;

/** Nav links, minus sections that are currently hidden. */
const hidden = new Set([!showInterviews && '#interviews'].filter(Boolean));
export const navLinks = site.nav.filter((n) => !hidden.has(n.href));
