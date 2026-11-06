import { getFormatter, getTranslations } from 'next-intl/server';
import {
  inviteAction,
  leaveOrgAction,
  removeMemberAction,
  revokeInvitationAction,
  setRoleAction,
} from '@/app/[locale]/orgs/[id]/members/actions';
import { ADMIN_ROLES, ORG_ROLES, roleRank, type MemberRole } from '@/lib/permissions';
import type { MemberRow, OrgSummary, PendingInvitation } from '@/server/services/orgs';
import ActionForm from './ActionForm';
import { Field } from './Field';

interface Props {
  locale: string;
  org: OrgSummary;
  meId: string;
  myRole: MemberRole;
  /** Permissions of myRole as stored in public.role_permissions. */
  perms: Set<string>;
  members: MemberRow[];
  invitations: PendingInvitation[];
}

/**
 * Members, invitations and role management. Controls are hidden when the user lacks the permission,
 * but this is only a convenience: every mutation is re-checked by the database RPCs.
 */
export default async function MembersManager({ locale, org, meId, myRole, perms, members, invitations }: Props) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const isMitra = org.type === 'mitra';
  const can = (orgPerm: string) => perms.has(isMitra ? 'admin:users' : orgPerm);
  const canInvite = can('member:invite');
  const canRemove = can('member:remove');
  const canSetRole = can('member:set_role');

  const assignable: readonly MemberRole[] = isMitra ? ADMIN_ROLES : ORG_ROLES.filter((r) => roleRank(r) <= roleRank(myRole));
  const canActOn = (m: MemberRow) => m.userId !== meId && (isMitra || myRole === 'owner' || roleRank(m.role) < roleRank(myRole));
  const hidden = (extra: Record<string, string>) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={org.id} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );

  return (
    <>
      <h2>{t('members.membersTitle')}</h2>
      {!canInvite && !canRemove && !canSetRole ? <p className="muted">{t('members.readOnly')}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('members.name')}</th>
              <th scope="col">{t('members.role')}</th>
              <th scope="col">{t('members.since')}</th>
              <th scope="col">{t('members.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isMe = m.userId === meId;
              const actable = canActOn(m);
              return (
                <tr key={m.userId}>
                  <td>
                    {m.displayName || t('members.noName')} {isMe ? <span className="muted">{t('members.you')}</span> : null}
                  </td>
                  <td>{t(`roles.${m.role}`)}</td>
                  <td>{fmt.dateTime(new Date(m.since), { dateStyle: 'medium', timeZone: 'UTC' })}</td>
                  <td>
                    {canSetRole && actable ? (
                      <ActionForm action={setRoleAction} submitLabel={t('members.changeRole')} variant="secondary" className="inline-form">
                        {hidden({ userId: m.userId })}
                        <div className="field">
                          <label htmlFor={`role-${m.userId}`}>{t('members.newRole')}</label>
                          <select id={`role-${m.userId}`} name="role" defaultValue={m.role}>
                            {assignable.map((r) => (
                              <option key={r} value={r}>
                                {t(`roles.${r}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </ActionForm>
                    ) : null}
                    {canRemove && actable ? (
                      <ActionForm action={removeMemberAction} submitLabel={t('members.remove')} variant="danger" className="inline-form">
                        {hidden({ userId: m.userId })}
                      </ActionForm>
                    ) : null}
                    {isMe ? (
                      <ActionForm action={leaveOrgAction} submitLabel={t('members.leave')} variant="danger" className="inline-form">
                        {hidden({})}
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canInvite ? (
        <>
          <h2>{t('members.inviteTitle')}</h2>
          <ActionForm action={inviteAction} submitLabel={t('members.inviteSubmit')}>
            {hidden({})}
            <Field id="invite-email" name="email" type="email" label={t('members.inviteEmail')} required autoComplete="off" inputMode="email" maxLength={254} />
            <div className="field">
              <label htmlFor="invite-role">{t('members.inviteRole')}</label>
              <select id="invite-role" name="role" defaultValue={isMitra ? assignable[0] : assignable[assignable.length - 1]}>
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </div>
          </ActionForm>

          <h2>{t('members.pendingTitle')}</h2>
          {invitations.length === 0 ? (
            <p>{t('members.pendingNone')}</p>
          ) : (
            <ul className="card-list">
              {invitations.map((i) => (
                <li key={i.id} className="card">
                  <p style={{ margin: 0 }}>
                    <strong>{i.email}</strong> &middot; {t(`roles.${i.role}`)}
                  </p>
                  <p className="muted" style={{ margin: '0 0 8px' }}>
                    {t('members.expires')}: {fmt.dateTime(new Date(i.expiresAt), { dateStyle: 'medium', timeZone: 'UTC' })}
                  </p>
                  <ActionForm action={revokeInvitationAction} submitLabel={t('members.revoke')} variant="secondary" className="inline-form">
                    {hidden({ invitationId: i.id })}
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </>
  );
}
