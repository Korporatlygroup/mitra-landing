type Tree = Record<string, unknown>;
const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copies only the listed dot-paths (a path may name a single message or a whole subtree) out of a message catalogue. */
export function pickMessages(all: Tree, paths: readonly string[]): Tree {
  const out: Tree = {};
  for (const path of paths) {
    const parts = path.split('.');
    let src: unknown = all;
    for (const p of parts) src = isTree(src) ? src[p] : undefined;
    if (src === undefined) continue;
    let dst = out;
    for (const p of parts.slice(0, -1)) {
      if (!isTree(dst[p])) dst[p] = {};
      dst = dst[p] as Tree;
    }
    const last = parts[parts.length - 1];
    dst[last] = isTree(dst[last]) && isTree(src) ? mergeMessages(dst[last] as Tree, src) : src;
  }
  return out;
}

/** Deep merge of two catalogues; values of `b` win. */
export function mergeMessages(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isTree(out[k]) && isTree(v) ? mergeMessages(out[k] as Tree, v) : v;
  return out;
}
