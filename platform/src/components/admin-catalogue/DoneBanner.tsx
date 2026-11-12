import { getTranslations } from 'next-intl/server';

const DONE_KEYS = [
  'partnerApproved',
  'partnerSuspended',
  'supplierApproved',
  'supplierRejected',
  'supplierInfoRequested',
  'supplierSuspended',
  'supplierReinstated',
  'productApproved',
  'productRejected',
  'productChangesRequested',
  'productSuspended',
  'productReinstated',
  'reportDismissed',
  'reportActioned',
] as const;

/**
 * Result of a decision, shown after the redirect from the server action (`?done=<key>`). Decision forms disappear once the item is
 * decided, so the confirmation cannot live inside the form. Only known keys are shown, so the parameter cannot inject text.
 */
export default async function DoneBanner({ locale, value }: { locale: string; value: string | string[] | undefined }) {
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || !(DONE_KEYS as readonly string[]).includes(key)) return null;
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const c = await getTranslations({ locale });
  return (
    <div role="status" aria-live="polite" data-testid="done-banner">
      <p className="message message-ok">
        <strong>{c('common.done')}: </strong>
        {t(`messages.${key}`)}
      </p>
    </div>
  );
}
