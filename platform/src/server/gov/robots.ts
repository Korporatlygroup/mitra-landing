/**
 * Minimal robots.txt evaluation. Rules from every `User-agent: *` group and every group naming our token are merged
 * (some sites publish several `*` groups). Longest matching rule wins; Allow wins a tie. Wildcards `*` and `$` are supported.
 */
export function robotsAllows(robotsTxt: string, agentToken: string, path: string): boolean {
  const token = agentToken.toLowerCase();
  const rules: { allow: boolean; pattern: string }[] = [];
  let applies = false;
  let inAgentBlock = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!inAgentBlock) applies = false;
      inAgentBlock = true;
      const v = value.toLowerCase();
      if (v === '*' || (v !== '' && token.includes(v))) applies = true;
    } else {
      inAgentBlock = false;
      if (applies && (key === 'allow' || key === 'disallow') && value !== '') rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}
