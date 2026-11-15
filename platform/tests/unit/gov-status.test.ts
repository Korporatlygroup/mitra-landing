import { describe, expect, it } from 'vitest';
import { categoryOf, daysUntil, displayStatus } from '@/lib/gov-status';

const today = new Date('2026-11-15T03:00:00Z');
const base = { publication_state: 'published', verification_status: 'verified', application_status: 'open', closes_on: null, is_stale: false };

describe('displayStatus', () => {
  it('shows open only for a verified, fresh programme the agency says is open', () => {
    expect(displayStatus(base, today)).toBe('open');
  });
  it('an expired deadline is never shown as active, even when the stored status still says open', () => {
    expect(displayStatus({ ...base, closes_on: '2026-11-14' }, today)).toBe('closed');
  });
  it('a deadline today is still open', () => {
    expect(displayStatus({ ...base, closes_on: '2026-11-15' }, today)).toBe('open');
  });
  it('stale or unconfirmed records are never open', () => {
    expect(displayStatus({ ...base, is_stale: true }, today)).toBe('stale');
    expect(displayStatus({ ...base, verification_status: 'unconfirmed' }, today)).toBe('stale');
  });
  it('records waiting for a reviewer are under review', () => {
    for (const v of ['discovered', 'extracted', 'pending_review']) expect(displayStatus({ ...base, verification_status: v }, today)).toBe('under_review');
  });
  it('archived wins over everything', () => {
    expect(displayStatus({ ...base, publication_state: 'archived' }, today)).toBe('archived');
    expect(displayStatus({ ...base, verification_status: 'archived', closes_on: '2030-01-01' }, today)).toBe('archived');
  });
  it('upcoming and unknown dates are distinguished', () => {
    expect(displayStatus({ ...base, application_status: 'upcoming' }, today)).toBe('upcoming');
    expect(displayStatus({ ...base, application_status: 'unknown' }, today)).toBe('dates_not_confirmed');
  });
  it('an agency that says closed is closed', () => {
    expect(displayStatus({ ...base, application_status: 'closed' }, today)).toBe('closed');
  });
});

describe('categoryOf and daysUntil', () => {
  it('uses the stored category, else derives one from the funding type, else other', () => {
    expect(categoryOf({ category: 'advisory', funding_type: 'grant' })).toBe('advisory');
    expect(categoryOf({ funding_type: 'financing' })).toBe('business_financing');
    expect(categoryOf({ funding_type: 'subsidy' })).toBe('grants_funding');
    expect(categoryOf({ category: 'nonsense' })).toBe('other');
  });
  it('counts days to a known future date and nothing for unknown or past dates', () => {
    expect(daysUntil('2026-11-25', today)).toBe(10);
    expect(daysUntil('2026-11-15', today)).toBe(0);
    expect(daysUntil('2026-11-01', today)).toBeNull();
    expect(daysUntil(null, today)).toBeNull();
    expect(daysUntil('garbage', today)).toBeNull();
  });
});
