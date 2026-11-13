import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addMember, countInvitations, countMembers, createOrgAs, createUser, roleOf, rpcFromPage, signedClient, sql, uniq, uniqEmail, type TestUser } from './support/db';
import { API_URL, BASE_URL, PUBLISHABLE_KEY } from './support/env';
import { freshContext, loginUi } from './support/ui';

// E8 (S12): authorisation holds without the UI. Attackers are signed-in, low-privilege users who call the RPC
// endpoints and Server Actions directly. Every attempt must be rejected and nothing may change (checked with pg).

async function restFromPage(page: Page, token: string, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ url, key, token, method, path, body }) => {
      const r = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      return { status: r.status, text };
    },
    { url: API_URL, key: PUBLISHABLE_KEY, token, method, path, body },
  );
}

const decodeAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Hidden inputs of the (SSR) form that contains `marker` (e.g. the Remove button label). */
function formFields(html: string, marker: string): Record<string, string> {
  for (const m of html.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    if (!m[0].includes(`>${marker}<`)) continue;
    const out: Record<string, string> = {};
    for (const i of m[0].matchAll(/<input\b[^>]*>/g)) {
      const name = i[0].match(/\bname="([^"]*)"/)?.[1];
      if (!name) continue;
      out[decodeAttr(name)] = decodeAttr(i[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '');
    }
    return out;
  }
  throw new Error(`No SSR form with button "${marker}"`);
}

async function replayAction(req: APIRequestContext, pageUrl: string, fields: Record<string, string>, override: Record<string, string>) {
  const res = await req.post(pageUrl, { multipart: { ...fields, ...override }, headers: { origin: BASE_URL }, maxRedirects: 0 });
  return { status: res.status(), body: await res.text() };
}

test.describe('E8 server-side authorisation', () => {
  let owner: TestUser, victim: TestUser, spare: TestUser, viewer: TestUser, staff: TestUser, foreignOwner: TestUser;
  let orgA = '', orgB = '', inviteB = '';

  test.beforeEach(async () => {
    owner = await createUser('e8-ownerA');
    viewer = await createUser('e8-viewer');
    staff = await createUser('e8-staff');
    foreignOwner = await createUser('e8-ownerB');
    victim = await createUser('e8-victim');
    spare = await createUser('e8-spare');
    orgA = await createOrgAs(owner, 'business', `OrgA ${uniq('a')}`);
    orgB = await createOrgAs(foreignOwner, 'business', `OrgB ${uniq('b')}`);
    await addMember(orgA, viewer.id, 'viewer');
    await addMember(orgA, staff.id, 'staff');
    await addMember(orgB, victim.id, 'manager');
    await addMember(orgB, spare.id, 'staff');
    const fo = await signedClient(foreignOwner);
    const { data, error } = await fo.client.rpc('create_invitation', { p_org: orgB, p_email: uniqEmail('e8-pending'), p_role: 'viewer' });
    expect(error).toBeNull();
    inviteB = (data as { invitation_id: string }).invitation_id;
  });

  for (const who of ['viewer', 'staff'] as const) {
    test(`E8 ${who}: RPC calls against another organisation and their own are rejected without effect`, async ({ page }) => {
      const me = who === 'viewer' ? viewer : staff;
      await loginUi(page, me);
      await page.goto('/en');
      const tok = (await signedClient(me)).accessToken;
      const membersB = await countMembers(orgB);
      const membersA = await countMembers(orgA);
      const invB = await countInvitations(orgB);
      const invA = await countInvitations(orgA);

      const attempts: [string, string, Record<string, unknown>][] = [
        ['create_invitation', 'foreign org invite', { p_org: orgB, p_email: uniqEmail('e8-x'), p_role: 'viewer' }],
        ['remove_member', 'foreign org remove', { p_org: orgB, p_user: spare.id }],
        ['set_member_role', 'foreign org role change', { p_org: orgB, p_user: spare.id, p_role: 'viewer' }],
        ['set_member_role', 'foreign org promote self-added', { p_org: orgB, p_user: victim.id, p_role: 'owner' }],
        ['revoke_invitation', 'foreign org revoke', { p_invitation: inviteB }],
        ['create_invitation', 'own org invite', { p_org: orgA, p_email: uniqEmail('e8-y'), p_role: 'viewer' }],
        ['remove_member', 'own org remove owner', { p_org: orgA, p_user: owner.id }],
        ['set_member_role', 'own org demote owner', { p_org: orgA, p_user: owner.id, p_role: 'viewer' }],
        ['set_member_role', 'own org promote self', { p_org: orgA, p_user: me.id, p_role: 'owner' }],
      ];
      for (const [fn, label, body] of attempts) {
        const r = await rpcFromPage(page, tok, fn, body);
        expect(r.status, `${label} (${fn}) must be rejected, got ${r.status} ${JSON.stringify(r.body)}`).toBeGreaterThanOrEqual(400);
      }

      expect(await countMembers(orgB)).toBe(membersB);
      expect(await countMembers(orgA)).toBe(membersA);
      expect(await countInvitations(orgB)).toBe(invB);
      expect(await countInvitations(orgA)).toBe(invA);
      expect(await roleOf(orgB, victim.id)).toBe('manager');
      expect(await roleOf(orgB, spare.id)).toBe('staff');
      expect(await roleOf(orgA, owner.id)).toBe('owner');
      expect(await roleOf(orgA, me.id)).toBe(who);
      const inv = await sql(`select revoked_at from public.invitations where id = $1`, [inviteB]);
      expect(inv[0]!.revoked_at).toBeNull();
    });

    test(`E8 ${who}: direct PostgREST table writes cannot grant roles, add members or read foreign invitations`, async ({ page }) => {
      const me = who === 'viewer' ? viewer : staff;
      await loginUi(page, me);
      await page.goto('/en');
      const tok = (await signedClient(me)).accessToken;

      await restFromPage(page, tok, 'PATCH', `memberships?user_id=eq.${me.id}`, { role: 'owner' });
      await restFromPage(page, tok, 'POST', 'memberships', { org_id: orgB, user_id: me.id, role: 'owner' });
      await restFromPage(page, tok, 'POST', 'invitations', { org_id: orgB, email: uniqEmail('e8-z'), role: 'owner', token_hash: 'x'.repeat(64), expires_at: '2999-01-01', invited_by: me.id });
      await restFromPage(page, tok, 'DELETE', `memberships?org_id=eq.${orgB}`);
      await restFromPage(page, tok, 'DELETE', `memberships?org_id=eq.${orgA}&user_id=eq.${owner.id}`);
      await restFromPage(page, tok, 'PATCH', `organisations?id=eq.${orgB}`, { name: 'pwned' });
      await restFromPage(page, tok, 'POST', 'audit_log', { action: 'org.created', details: {} });
      expect(await roleOf(orgA, me.id)).toBe(who);
      expect(await roleOf(orgB, me.id)).toBeNull();
      expect(await roleOf(orgA, owner.id)).toBe('owner');
      expect(await countMembers(orgB)).toBe(3);
      expect((await sql(`select name from public.organisations where id = $1`, [orgB]))[0]!.name).not.toBe('pwned');
      expect(await sql(`select 1 from public.invitations where org_id = $1 and role = 'owner'`, [orgB])).toHaveLength(0);

      // Foreign data is invisible: pending invitations of org B and org B's roster are not readable.
      const inv = await restFromPage(page, tok, 'GET', `invitations?org_id=eq.${orgB}&select=id,email`);
      expect(JSON.parse(inv.text)).toEqual([]);
      const mem = await restFromPage(page, tok, 'GET', `memberships?org_id=eq.${orgB}&select=user_id,role`);
      expect(JSON.parse(mem.text)).toEqual([]);
      const aud = await restFromPage(page, tok, 'GET', 'audit_log?select=id&limit=5');
      expect(JSON.parse(aud.text)).toEqual([]);
    });

    test(`E8 ${who}: replayed Server Actions (remove, role change, invite) are rejected by the server`, async ({ page, browser }) => {
      const me = who === 'viewer' ? viewer : staff;

      // The owner's own page yields real, valid action forms (their ids are the same for every user).
      const ownerCtx = await freshContext(browser, page);
      const op = await ownerCtx.newPage();
      await loginUi(op, owner);
      const urlA = `/en/orgs/${orgA}/members`;
      const html = await (await ownerCtx.request.get(urlA)).text();
      const removeF = formFields(html, 'Remove');
      const roleF = formFields(html, 'Change role');
      const inviteF = formFields(html, 'Send invitation');

      // Control: the technique works for someone who is allowed (owner removes the staff member of their own org).
      const ctrlUser = await createUser('e8-ctrl');
      await addMember(orgA, ctrlUser.id, 'viewer');
      const ctrl = await replayAction(ownerCtx.request, urlA, removeF, { orgId: orgA, userId: ctrlUser.id, locale: 'en' });
      expect(ctrl.status).toBeLessThan(500);
      await expect.poll(() => roleOf(orgA, ctrlUser.id), 'control: the owner replay must really remove the member').toBeNull();
      await ownerCtx.close();

      // Attacker replays the same forms against the foreign org and their own.
      await loginUi(page, me);
      const urlB = `/en/orgs/${orgB}/members`;
      const before = { m: await countMembers(orgB), a: await countMembers(orgA), i: await countInvitations(orgB), ia: await countInvitations(orgA) };
      const targets: [string, Record<string, string>, Record<string, string>][] = [
        ['remove foreign', removeF, { orgId: orgB, userId: spare.id, locale: 'en' }],
        ['role foreign', roleF, { orgId: orgB, userId: spare.id, role: 'viewer', locale: 'en' }],
        ['promote foreign', roleF, { orgId: orgB, userId: victim.id, role: 'owner', locale: 'en' }],
        ['invite foreign', inviteF, { orgId: orgB, email: uniqEmail('e8-act'), role: 'owner', locale: 'en' }],
        ['remove own-org owner', removeF, { orgId: orgA, userId: owner.id, locale: 'en' }],
        ['promote self', roleF, { orgId: orgA, userId: me.id, role: 'owner', locale: 'en' }],
        ['invite own org', inviteF, { orgId: orgA, email: uniqEmail('e8-act2'), role: 'viewer', locale: 'en' }],
      ];
      for (const [label, fields, override] of targets) {
        const url = override.orgId === orgB ? urlB : urlA;
        const r = await replayAction(page.request, url, fields, override);
        expect(r.status, label).toBeLessThan(500);
        // The page payload embeds every message, so look at the action's returned state instead.
        expect(r.body.includes(`"status":"success"`), `${label}: the action must not report success`).toBe(false);
        expect(r.body.includes(`"status":"error"`), `${label}: the action must report an error`).toBe(true);
      }
      expect(await countMembers(orgB)).toBe(before.m);
      expect(await countMembers(orgA)).toBe(before.a);
      expect(await countInvitations(orgB)).toBe(before.i);
      expect(await countInvitations(orgA)).toBe(before.ia);
      expect(await roleOf(orgB, spare.id)).toBe('staff');
      expect(await roleOf(orgB, victim.id)).toBe('manager');
      expect(await roleOf(orgA, owner.id)).toBe('owner');
      expect(await roleOf(orgA, me.id)).toBe(who);
    });
  }

  test('E8 an unauthenticated caller cannot use the RPCs or the actions', async ({ page, request }) => {
    await page.goto('/en');
    const r = await rpcFromPage(page, PUBLISHABLE_KEY, 'remove_member', { p_org: orgB, p_user: spare.id });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const html = await (await (await freshOwnerPage(page, owner, orgA)).text());
    const removeF = formFields(html, 'Remove');
    const res = await replayAction(request, `/en/orgs/${orgB}/members`, removeF, { orgId: orgB, userId: spare.id, locale: 'en' });
    expect(res.status).toBeLessThan(500);
    expect(await roleOf(orgB, spare.id)).toBe('staff');
  });
});

const msgs = {
  removed: 'Member removed.',
  roleChanged: 'Role changed.',
  invited: 'Invitation sent.',
};

async function freshOwnerPage(page: Page, owner: TestUser, orgId: string) {
  const ctx = await freshContext(page.context().browser()!, page);
  const p = await ctx.newPage();
  await loginUi(p, owner);
  const res = await ctx.request.get(`/en/orgs/${orgId}/members`);
  return res;
}
