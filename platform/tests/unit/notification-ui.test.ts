import { describe, expect, it } from 'vitest';
import { notificationLabelKey, notificationTarget } from '@/lib/notification-ui';
import type { NotificationRow } from '@/server/services/verification';
import en from '../../messages/en.json';

// The Phase 6 sourcing notifications and the Phase 7 programme notifications share one helper after the Phase 1-7 integration.
const row = (over: Partial<NotificationRow>): NotificationRow => ({ id: 'n1', kind: 'x', entity_type: null, entity_id: null, org_id: null, read_at: null, created_at: '2026-11-15T00:00:00Z', ...over }) as NotificationRow;
type Tree = { [k: string]: Tree | string | undefined };
const tree = en as unknown as Tree;
const lookup = (key: string) => key.split('.').reduce<Tree | string | undefined>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);

describe('notification helper after the Phase 1-7 integration', () => {
  it.each([
    'sourcing_rfq_received', 'sourcing_partner_response', 'sourcing_message', 'sourcing_quote_received', 'sourcing_selected',
    'sourcing_counter', 'sourcing_counter_response', 'sourcing_sample_requested', 'sourcing_document_uploaded', 'sourcing_quote_reminder',
  ])('%s has its own message, not the generic one', (kind) => {
    const key = notificationLabelKey(kind);
    expect(key).toBe(`notifications.kinds.${kind}`);
    expect(typeof lookup(key)).toBe('string');
  });
  it('an unknown kind falls back to the generic message', () => {
    expect(notificationLabelKey('totally_new_kind')).toBe('notifications.kinds.other');
  });
  it('a sourcing notification opens the request for the partner that received it', () => {
    expect(notificationTarget(row({ entity_type: 'sourcing_rfq', entity_id: 'r1', org_id: 'o1' }))).toBe('/sourcing/r1?partner=o1');
    expect(notificationTarget(row({ entity_type: 'sourcing_rfq', entity_id: 'r1', org_id: null }))).toBeNull();
  });
  it('programme notifications still point at the saved list', () => {
    expect(notificationLabelKey('gov.deadline')).toBe('gov.notif.deadline');
    expect(notificationLabelKey('gov.recheck')).toBe('gov.notif.recheck');
    expect(notificationTarget(row({ entity_type: 'gov_programme', entity_id: 'p1' }))).toBe('/business-help/saved');
  });
});
