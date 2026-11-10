import site from '../../content/site.json';
import { getMedia } from './media';

/** Interview videos whose file exists in public/. With none, the section and its nav link are hidden. */
export const readyInterviews = site.interviews.items.filter((i) => getMedia(i.media).available);
export const showInterviews = readyInterviews.length > 0;

/** Nav links, minus sections that are currently hidden. */
const hidden = new Set([!showInterviews && '#interviews'].filter(Boolean));
export const navLinks = site.nav.filter((n) => !hidden.has(n.href));
