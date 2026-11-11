import { buildInviteEmail } from './invite-email';
import type { MailMessage } from './mailer';

/**
 * The invitation for the owner of an organisation that MITRA set up as a partner. Same three-language text as every other
 * invitation (English, Tamil, Bahasa Melayu, role "Owner"). Partner owners accept through their own page
 * (/invite/partner/<token>), because the general invitation page uses the generic accept function, which refuses them.
 * The link carries the one-time token: callers must not log the returned message.
 */
export function buildPartnerInviteEmail(args: { to: string; orgName: string; siteUrl: string; locale: string; token: string }): MailMessage {
  const link = `${args.siteUrl}/${args.locale}/invite/partner/${args.token}`;
  return buildInviteEmail({ to: args.to, orgName: args.orgName, role: 'owner', link });
}
