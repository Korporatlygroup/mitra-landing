// Builds messages/rd/rd.{en,ms,ta}.json from the area files in this folder (shell.cjs, public.cjs, ...).
// Each area file exports a tree whose leaves are [en, ms, ta] triples. Tamil and Bahasa Melayu are machine-assisted and need native review.
const fs = require('fs');
const path = require('path');

const isLeaf = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'string');
function split(tree, i) {
  if (isLeaf(tree)) return tree[i];
  const out = {};
  for (const [k, v] of Object.entries(tree)) out[k] = split(v, i);
  return out;
}
function merge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && !isLeaf(a[k]) && !isLeaf(v)) merge(a[k], v);
    else a[k] = v;
  }
  return a;
}

const dir = __dirname;
let all = {};
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith('.cjs') || f === 'build-messages.cjs') continue;
  all = merge(all, require(path.join(dir, f)));
}
const outDir = path.join(dir, '..', '..', 'messages', 'rd');
fs.mkdirSync(outDir, { recursive: true });
['en', 'ms', 'ta'].forEach((loc, i) => {
  fs.writeFileSync(path.join(outDir, `rd.${loc}.json`), JSON.stringify(split(all, i), null, 2) + '\n');
});
console.log('messages/rd written');
