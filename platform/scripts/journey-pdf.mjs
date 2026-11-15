// Builds one PDF from test-results/journey (screenshots + captions.json). Laptop screenshots (1280 px wide) are cut into
// page-sized slices when tall; very long pages keep their first three slices and say so.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const dir = path.resolve('test-results/journey');
const out = process.argv[2] ?? path.join(dir, 'INOK-platform-journey-laptop.pdf');
const caps = JSON.parse(fs.readFileSync(path.join(dir, 'captions.json'), 'utf8'));
const W = 1280, H = 1000, HEAD = 120, SLICE = H - HEAD;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dims = (f) => {
  const b = fs.readFileSync(path.join(dir, f));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const chapters = [...new Set(caps.map((c) => c.chapter))];
let page = 1;
const toc = [];
let body = '';
caps.forEach((c, i) => {
  const { h } = dims(c.file);
  const slices = Math.ceil(h / SLICE);
  const shown = Math.min(slices, 3);
  if (!toc.find((t) => t.chapter === c.chapter)) toc.push({ chapter: c.chapter, page: page + 1 });
  for (let s = 0; s < shown; s++) {
    page += 1;
    const more = slices > shown && s === shown - 1 ? `<div class="more">This page continues for ${slices - shown} more screen heights (${h}px tall in total); the rest is the same list or form.</div>` : '';
    body += `<section class="pg"><header><div class="ch">${esc(c.chapter)}</div><h2>${i + 1}. ${esc(c.title)}${shown > 1 ? ` <span class="cont">(${s + 1}/${shown})</span>` : ''}</h2><div class="meta"><code>${esc(c.url)}</code>${c.note ? ` &nbsp;·&nbsp; ${esc(c.note)}` : ''}</div></header>
<div class="view" style="background-image:url('${pathToFileURL(path.join(dir, c.file)).href}');background-position:0 -${s * SLICE}px;"></div>${more}</section>`;
  }
});
const tocHtml = toc.map((t) => `<li><span>${esc(t.chapter)}</span><b>p. ${t.page}</b></li>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
@page { size: ${W}px ${H}px; margin: 0 }
* { box-sizing: border-box } body { margin: 0; font-family: Segoe UI, Arial, sans-serif; color: #1f2328 }
.pg { width: ${W}px; height: ${H}px; page-break-after: always; overflow: hidden; position: relative; background: #fff }
header { height: ${HEAD}px; padding: 18px 28px 0; border-bottom: 2px solid #1f2328; background: #f6f1e4 }
.ch { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #6b5d3a } h2 { margin: 4px 0 6px; font-size: 24px } .cont { font-weight: 400; color: #6b5d3a; font-size: 16px }
.meta { font-size: 13px; color: #444 } code { background: #fff; padding: 1px 6px; border: 1px solid #d8cfb8; border-radius: 4px }
.view { width: ${W}px; height: ${SLICE}px; background-repeat: no-repeat; background-size: ${W}px auto; border-top: 1px solid #ccc }
.more { position: absolute; bottom: 8px; right: 12px; background: #1f2328; color: #fff; font-size: 13px; padding: 4px 10px; border-radius: 4px }
.cover { padding: 90px 80px } .cover h1 { font-size: 46px; margin: 0 0 12px } .cover p { font-size: 19px; max-width: 900px; line-height: 1.5 }
.cover ul { list-style: none; padding: 0; margin: 28px 0 0; max-width: 760px } .cover li { display: flex; justify-content: space-between; border-bottom: 1px solid #ddd; padding: 8px 0; font-size: 18px }
</style>
<section class="pg cover"><h1>INOK platform: whole user journey</h1>
<p>Laptop view (1280 x 800). Every screen was captured while the steps were really performed against a local test copy with synthetic data: sign-up, onboarding, document upload, review, request, quotation, catalogue, partner dashboard and government business help. Tall pages are split across several PDF pages. The path under each title is the page address.</p>
<p>${caps.length} screens, ${chapters.length} chapters.</p><ul>${tocHtml}</ul></section>
${body}`;
fs.writeFileSync(path.join(dir, 'journey.html'), html);
const browser = await chromium.launch();
const pg = await browser.newPage();
await pg.goto(pathToFileURL(path.join(dir, 'journey.html')).href);
await pg.pdf({ path: out, width: `${W}px`, height: `${H}px`, printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(out, fs.statSync(out).size, 'bytes,', page, 'pages');
