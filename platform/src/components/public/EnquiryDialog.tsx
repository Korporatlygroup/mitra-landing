'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendEnquiryAction } from '@/app/[locale]/directory/actions';
import { FormMessage } from '@/components/ActionForm';
import Icon from '@/components/ui/Icon';
import { Dialog } from '@/components/ui/Overlay';
import { Link } from '@/i18n/navigation';
import { idle } from '@/lib/form-state';

function Send({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

/** "Send enquiry" button and its dialog. Signed-out visitors get a sign-in button instead of the form. */
export default function EnquiryDialog({
  slug,
  name,
  accepting,
  signedIn,
  orgs,
  next,
}: {
  slug: string;
  name: string;
  accepting: boolean;
  signedIn: boolean;
  orgs: { id: string; name: string }[];
  next: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(sendEnquiryAction, idle);
  const formRef = useRef<HTMLFormElement>(null);
  const sent = state.status === 'success';

  useEffect(() => {
    const form = formRef.current;
    if (!form || state.status !== 'error' || !state.values) return;
    for (const [n, v] of Object.entries(state.values)) {
      const el = form.elements.namedItem(n);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) if (el.type !== 'hidden') el.value = v;
    }
  }, [state]);

  if (!accepting) return <span className="tag t-gray tag-lg">{t('dir2.busyNote')}</span>;
  if (!signedIn) {
    return (
      <Link className="btn btn-primary" href={`/login?next=${next}`}>
        {t('dir2.signInToSend')}
      </Link>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {t('dir2.send')}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={sent ? t('dir2.sentTitle', { name }) : t('dir2.dialogTitle', { name })} closeLabel={t('ws.close')}>
        {sent ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '8px 0 4px' }}>
            <span style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--tag-green-bg)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={30} stroke={2.6} />
            </span>
            <FormMessage state={state} />
            <span className="mut">{t('dir2.sentSub')}</span>
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <Link className="btn btn-secondary" href="/requests">
                {t('nav.requests')}
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => setOpen(false)} data-autofocus>
                {t('common.done')}
              </button>
            </div>
          </div>
        ) : (
          <form ref={formRef} action={action} className="form" style={{ maxWidth: 'none' }}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            {orgs.length > 1 ? (
              <div className="field">
                <label htmlFor="enq-org">{t('dir2.dialogAs')}</label>
                <select id="enq-org" name="buyerOrgId" defaultValue={orgs[0]!.id}>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="enq-topic">{t('dir2.dialogNeed')}</label>
              <input id="enq-topic" name="topic" type="text" required minLength={3} maxLength={200} placeholder={t('dir2.dialogNeedPh')} data-autofocus />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '1 1 140px' }}>
                <label htmlFor="enq-qty">{t('dir2.dialogQty')}</label>
                <input id="enq-qty" name="quantity" type="text" maxLength={60} />
              </div>
              <div className="field" style={{ flex: '1 1 140px' }}>
                <label htmlFor="enq-by">{t('dir2.dialogBy')}</label>
                <input id="enq-by" name="neededBy" type="date" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="enq-details">{t('dir2.dialogDetails')}</label>
              <textarea id="enq-details" name="details" rows={4} maxLength={800} required placeholder={t('dir2.dialogDetailsPh')} />
            </div>
            <span className="mut" style={{ fontSize: '0.8125rem' }}>
              {t('dir2.dialogPrivacy')}
            </span>
            <FormMessage state={state} />
            <Send label={t('dir2.send')} />
          </form>
        )}
      </Dialog>
    </>
  );
}
