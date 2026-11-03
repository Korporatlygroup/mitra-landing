import site from '../../content/site.json';

/** Stories with a real quote. Never invent testimonials: with fewer than this, the section stays hidden. */
export const MIN_STORIES = 2;
export const readyStories = site.stories.items.filter((s) => s.quote);
export const showStories = readyStories.length >= MIN_STORIES;
export const showBeyond = !site.beyond.verify;

/** Nav links, minus sections that are currently hidden. */
const hidden = new Set([!showStories && '#stories', !showBeyond && '#beyond'].filter(Boolean));
export const navLinks = site.nav.filter((n) => !hidden.has(n.href));
