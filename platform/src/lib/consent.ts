/**
 * Consent text version. Must equal private.current_consent_version() in the database; the DB records consent
 * (sign-up metadata, grant_consent) only for this exact value and requires it before create_org / accept_invitation.
 */
export const CONSENT_VERSION = '2026-07';
export const CONSENT_PURPOSES = ['terms', 'privacy'] as const;
