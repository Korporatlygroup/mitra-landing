import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES, ROLE_PERMISSIONS, isAdminRole, requiresMfa, roleRank } from '@/lib/permissions';
import { migrations } from './helpers';

const sql = migrations();
const seedFile = sql.find((m) => m.file.includes('permissions'))!.text;

/** Role/permission pairs inserted by ANY migration (the seed is spread across several files). */
function sqlSeedPairs(): string[] {
  const pairs: string[] = [];
  for (const { text } of sql) {
    let from = 0;
    for (;;) {
      const start = text.indexOf('insert into public.role_permissions', from);
      if (start === -1) break;
      const end = text.indexOf(';', start);
      const block = text.slice(start, end);
      pairs.push(...[...block.matchAll(/\('([a-z_]+)',\s*'([a-z_:]+)'\)/g)].map((m) => `${m[1]}|${m[2]}`));
      from = end;
    }
  }
  expect(pairs.length).toBeGreaterThan(20);
  return pairs.sort();
}

describe('permissions map', () => {
  it('equals the SQL seed in the permissions migration exactly', () => {
    const ts = Object.entries(ROLE_PERMISSIONS)
      .flatMap(([role, perms]) => perms.map((p) => `${role}|${p}`))
      .sort();
    expect(ts).toEqual(sqlSeedPairs());
  });

  it('covers every member_role enum value declared in the foundation migration', () => {
    const foundation = sql[0].text;
    const enumBody = foundation.match(/create type public\.member_role as enum \(([^)]*)\)/)![1];
    const roles = [...enumBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...MEMBER_ROLES].sort()).toEqual(roles);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(roles);
  });

  it('mirrors private.role_rank', () => {
    const fn = seedFile.slice(seedFile.indexOf('function private.role_rank'));
    const body = fn.slice(0, fn.indexOf('$$;', fn.indexOf('select case')));
    const sqlRanks = Object.fromEntries([...body.matchAll(/when '([a-z_]+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    for (const role of MEMBER_ROLES) expect(roleRank(role)).toBe(sqlRanks[role] ?? 0);
  });

  it('mirrors is_admin_role and requires_mfa', () => {
    expect(MEMBER_ROLES.filter(isAdminRole).sort()).toEqual(['admin_content', 'admin_ops', 'admin_review', 'admin_super', 'admin_support']);
    expect(requiresMfa('owner', 'partner')).toBe(true);
    expect(requiresMfa('manager', 'partner')).toBe(false);
    expect(requiresMfa('owner', 'business')).toBe(false);
    expect(requiresMfa('admin_review', 'mitra')).toBe(true);
  });
});
