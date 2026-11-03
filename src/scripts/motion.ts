// All page behaviour in one small, dependency-free module.
// Everything degrades: without JS the page is complete and static; with reduced motion, nothing moves.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = <T extends Element>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

/* ---------- Scroll reveals (one-shot) ---------- */
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        revealIO.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
);
// Only elements that are below the fold right now get hidden for a reveal; anything already
// on screen stays exactly as rendered, so the first frame is always complete.
const observeReveals = (root: ParentNode = document) => {
  if (reduce) return;
  $$<HTMLElement>('[data-reveal]:not(.is-in):not(.is-pre)', root).forEach((el) => {
    if (el.closest('[hidden]') || el.getBoundingClientRect().top < innerHeight) return;
    el.classList.add('is-pre');
    revealIO.observe(el);
  });
};
observeReveals();

/* ---------- Hero background video: only loads when motion is welcome ---------- */
const bg = $<HTMLVideoElement>('video[data-bg-video]');
if (bg && !reduce && bg.dataset.src) {
  bg.src = bg.dataset.src;
  bg.addEventListener('playing', () => bg.classList.add('is-playing'), { once: true });
  bg.play().catch(() => { /* autoplay blocked: the still image stays */ });
}

/* ---------- Nav: shadow once scrolled, active link follows the section in view ---------- */
const nav = $<HTMLElement>('[data-nav]');
const spyLinks = $$<HTMLAnchorElement>('[data-spy]');
const sections = spyLinks
  .map((a) => document.querySelector<HTMLElement>(a.getAttribute('href')!))
  .filter((s): s is HTMLElement => !!s);
// Active = the last linked section whose top has passed the middle of the screen.
// (Unlinked sections in between, like Curriculum or Trainer, keep the previous link lit.)
let spyCurrent = '';
function updateSpy() {
  let id = '';
  for (const s of sections) if (s.getBoundingClientRect().top < innerHeight * 0.5) id = `#${s.id}`;
  if (id === spyCurrent) return;
  spyCurrent = id;
  spyLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === id));
}

// Mobile menu closes after choosing a link.
const mobileMenu = $<HTMLDetailsElement>('.nav__mobile');
mobileMenu?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => (mobileMenu.open = false)));

/* ---------- Journey: progress line, reached dots, live "you are here" panel ---------- */
const journey = $<HTMLElement>('[data-journey]');
const steps = $$<HTMLElement>('[data-step]');
const fill = $<HTMLElement>('[data-journey-fill]');
const bar = $<HTMLElement>('[data-journey-bar]');
const phaseEl = $<HTMLElement>('[data-journey-phase]');
const dateEl = $<HTMLElement>('[data-journey-date]');
let activeStep = -1;

function updateJourney() {
  if (!journey) return;
  const r = journey.getBoundingClientRect();
  const focus = innerHeight * 0.55; // the line "arrives" at just below mid-screen
  const p = Math.min(1, Math.max(0, (focus - r.top) / r.height));
  fill?.style.setProperty('--p', String(p));
  bar?.style.setProperty('--p', String(p));

  let current = -1;
  steps.forEach((s, i) => {
    const reached = s.getBoundingClientRect().top < focus;
    s.classList.toggle('is-reached', reached);
    if (reached) current = i;
  });
  if (current !== activeStep) {
    activeStep = current;
    steps.forEach((s, i) => s.classList.toggle('is-active', i === current));
    const s = steps[Math.max(0, current)];
    if (s && dateEl && phaseEl && dateEl.textContent !== s.dataset.date) {
      dateEl.classList.add('is-swapping');
      setTimeout(() => {
        dateEl.textContent = s.dataset.date ?? '';
        phaseEl.textContent = s.dataset.phase ?? '';
        dateEl.classList.remove('is-swapping');
      }, reduce ? 0 : 180);
    }
  }
}

/* ---------- One rAF-throttled scroll handler for everything scroll-linked ---------- */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    nav?.classList.toggle('is-scrolled', scrollY > 8);
    updateJourney();
    updateSpy();
    ticking = false;
  });
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });
onScroll();

/* ---------- Impact: the 26-day grid explains itself on hover, focus or tap ---------- */
const readout = $<HTMLElement>('[data-days-readout]');
const dayBtns = $$<HTMLButtonElement>('[data-days] button');
const hint = readout?.textContent ?? '';
let pinned: HTMLButtonElement | null = null;
const show = (b: HTMLButtonElement | null) => {
  if (readout) readout.textContent = b?.dataset.label ?? hint;
  dayBtns.forEach((x) => x.classList.toggle('is-current', x === b));
};
dayBtns.forEach((b) => {
  b.removeAttribute('title'); // the readout replaces the native tooltip once JS runs
  b.addEventListener('pointerenter', () => show(b));
  b.addEventListener('focus', () => show(b));
  b.addEventListener('click', () => { pinned = pinned === b ? null : b; show(pinned); });
});
$('[data-days]')?.addEventListener('pointerleave', () => show(pinned));

/* ---------- About poster: subtle 3D tilt that follows the pointer ---------- */
if (finePointer && !reduce) {
  $$<HTMLElement>('[data-tilt]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(800px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`;
    });
    el.addEventListener('pointerleave', () => (el.style.transform = ''));
  });
}

/* ---------- Gallery: filter, bento rhythm, show all, lightbox ---------- */
const grid = $<HTMLElement>('[data-gallery]');
if (grid) {
  const tiles = $$<HTMLLIElement>('[data-tags]', grid);
  const filterBtns = $$<HTMLButtonElement>('#gallery [data-filter]');
  const moreBtn = $<HTMLButtonElement>('[data-gallery-more]');
  const initial = Number(grid.dataset.initial) || tiles.length;
  let filter = 'all';
  let expanded = false;

  const visibleTiles = () => tiles.filter((t) => !t.hidden);

  const layout = () => {
    const matching = tiles.filter((t) => filter === 'all' || t.dataset.tags!.split(' ').includes(filter));
    const limit = expanded || filter !== 'all' ? matching.length : initial;
    tiles.forEach((t) => (t.hidden = true));
    matching.slice(0, limit).forEach((t, i) => {
      t.hidden = false;
      t.classList.toggle('tile--lg', i % 6 === 0);
      t.style.setProperty('--d', String((i % 6) * 60));
    });
    if (moreBtn) {
      moreBtn.parentElement!.hidden = filter !== 'all';
      moreBtn.textContent = expanded ? moreBtn.dataset.less! : moreBtn.dataset.more!;
      moreBtn.setAttribute('aria-expanded', String(expanded));
    }
    observeReveals(grid);
  };

  const swap = (fn: () => void) => {
    // Use the View Transitions API where available so tiles glide to their new spots.
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (d.startViewTransition && !reduce) d.startViewTransition(fn);
    else fn();
  };

  filterBtns.forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.filter!;
      filterBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      swap(layout);
    }),
  );
  moreBtn?.addEventListener('click', () => {
    expanded = !expanded;
    swap(layout);
    if (!expanded) grid.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });

  // Lightbox (native <dialog>: focus trap, Esc and backdrop handled by the browser).
  const dlg = $<HTMLDialogElement>('[data-lightbox]');
  const img = $<HTMLImageElement>('[data-lightbox-img]');
  const cap = $<HTMLElement>('[data-lightbox-cap]');
  const count = $<HTMLElement>('[data-lightbox-count]');
  let index = 0;
  const open = (i: number) => {
    const list = visibleTiles();
    if (!dlg || !img || !list.length) return;
    index = (i + list.length) % list.length;
    const btn = $<HTMLButtonElement>('.tile__btn', list[index])!;
    img.classList.add('is-switching');
    img.onload = () => img.classList.remove('is-switching');
    img.src = btn.dataset.full!;
    img.alt = btn.dataset.alt ?? '';
    if (cap) cap.textContent = btn.dataset.alt ?? '';
    if (count) count.textContent = `${index + 1} / ${list.length}`;
    if (!dlg.open) dlg.showModal();
  };
  grid.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('.tile__btn');
    if (!btn) return;
    open(visibleTiles().indexOf(btn.closest('li')!));
  });
  dlg?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const action = t.closest<HTMLElement>('[data-lb]')?.dataset.lb;
    if (action === 'close' || t === dlg || t.tagName === 'FIGURE') dlg.close();
    else if (action === 'prev') open(index - 1);
    else if (action === 'next') open(index + 1);
  });
  dlg?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') open(index - 1);
    if (e.key === 'ArrowRight') open(index + 1);
  });
  // Swipe left/right on touch screens.
  let startX = 0;
  dlg?.addEventListener('touchstart', (e) => (startX = e.touches[0].clientX), { passive: true });
  dlg?.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) open(index + (dx < 0 ? 1 : -1));
  });
  dlg?.addEventListener('close', () => { if (img) img.removeAttribute('src'); });
}
