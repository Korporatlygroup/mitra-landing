import type { NotificationRow } from '@/server/services/verification';

export const KNOWN_KINDS = new Set([
  'verification_approved',
  'verification_rejected',
  'verification_info_requested',
  'listing_approved',
  'listing_rejected',
  'listing_changes_requested',
  'listing_suspended',
  'listing_reinstated',
  'request_invited',
  'request_interested',
  'request_question',
  'request_declined',
  'request_removed',
  'enquiry_opened',
]);

export const GOV_CATEGORIES = new Set(['new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder']);

/** Locale-less path a notification points at (null when there is nothing to open). */
export function notificationTarget(n: NotificationRow): string | null {
  if (n.entity_type === 'gov_programme') return '/business-help/saved';
  if (n.entity_type === 'verification_claim' && n.org_id) return `/orgs/${n.org_id}/business/verification`;
  if (n.entity_type === 'listing' && n.org_id) return `/orgs/${n.org_id}/business/listing`;
  if (n.entity_type === 'buyer_request' && n.entity_id) {
    return n.kind === 'request.invited' && n.org_id ? `/orgs/${n.org_id}/business/requests/${n.entity_id}` : `/requests/${n.entity_id}`;
  }
  if (n.entity_type === 'enquiry' && n.entity_id) return `/enquiries/${n.entity_id}`;
  return null;
}

/** Message key (relative to the full tree) that describes a notification. */
export function notificationLabelKey(kind: string): string {
  const key = kind.replace(/\./g, '_');
  const govCat = kind.startsWith('gov.') ? kind.slice(4) : null;
  if (govCat && GOV_CATEGORIES.has(govCat)) return `gov.notif.${govCat}`;
  return `notifications.kinds.${KNOWN_KINDS.has(key) ? key : 'other'}`;
}
