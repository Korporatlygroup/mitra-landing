'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function DocumentUploadForm({ rfq, partner }: { rfq: string; partner: string }) {
  const t = useTranslations('p6');
  const errors = useTranslations('errors');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <form onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    const form = event.currentTarget;
    try {
      const body = new FormData(form);
      body.set('partner', partner);
      const response = await fetch(`/api/v1/sourcing/${rfq}/documents`, { method: 'POST', body });
      const result = await response.json() as { ok: boolean; errorKey?: string };
      if (!result.ok) setMessage(result.errorKey && errors.has(result.errorKey) ? errors(result.errorKey!) : t('uploadFailed'));
      else { form.reset(); setMessage(t('documentUploaded')); router.refresh(); }
    } catch { setMessage(t('uploadFailed')); }
    finally { setBusy(false); }
  }}>
    <div className="field"><label htmlFor={`sourcing-file-${partner}`}>{t('attachment')}</label>
      <input id={`sourcing-file-${partner}`} type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        required disabled={busy} /></div>
    <p className="hint">{t('attachmentHint')}</p>
    <button className="btn btn-secondary" type="submit" disabled={busy}>{t('uploadDocument')}</button>
    {message ? <p role="status">{message}</p> : null}
  </form>;
}
