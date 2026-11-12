'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';

interface Props {
  /** Same-origin upload route, e.g. /api/v1/suppliers/<id>/documents */
  endpoint: string;
  accept: string;
  /** Allowed MIME types (client-side hint; the server decides). */
  types: string[];
  /** Human list for the message, e.g. "PDF, PNG, JPEG". */
  typesLabel: string;
  maxBytes: number;
  label: string;
  hint: string;
  button: string;
  /** Extra form fields (select, text) sent with the file. */
  children?: ReactNode;
  /** Called with the server's JSON on success (before the page refreshes). */
  onUploaded?: (r: { id: string; scanStatus?: string }) => void;
  /** Message shown after a successful upload, given the scan status the server reported. */
  successText: (scanStatus: string | undefined) => string;
}

/**
 * Browser upload with progress to one of the file routes (the browser never talks to storage). Same-origin multipart POST, no JSON body.
 * Result messages are announced (role=status / role=alert). After success the page data is refreshed.
 */
export default function FileUploader({ endpoint, accept, types, typesLabel, maxBytes, label, hint, button, children, onUploaded, successText }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const busy = progress !== null;

  const fail = (key: string) => setMsg({ kind: 'error', text: key === 'network_error' ? t('p5partner.common.networkError') : t(t.has(`errors.${key}`) ? `errors.${key}` : 'errors.internal') });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = formRef.current;
    if (!form) return;
    const input = form.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];
    setMsg(null);
    if (!file) return fail('file_empty');
    if (file.size === 0) return fail('file_empty');
    if (file.size > maxBytes) return setMsg({ kind: 'error', text: t('p5partner.common.fileTooBig', { max: Math.round(maxBytes / 1048576) }) });
    if (file.type && !types.includes(file.type)) return setMsg({ kind: 'error', text: t('p5partner.common.fileTypeNot', { types: typesLabel }) });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onerror = () => {
      setProgress(null);
      fail('network_error');
    };
    xhr.onload = () => {
      setProgress(null);
      const body = xhr.response as { ok?: boolean; id?: string; scanStatus?: string; errorKey?: string } | null;
      if (body?.ok && body.id) {
        setMsg({ kind: 'ok', text: successText(body.scanStatus) });
        form.reset();
        onUploaded?.({ id: body.id, scanStatus: body.scanStatus });
        router.refresh();
      } else fail(body?.errorKey && /^[a-z_]+$/.test(body.errorKey) ? body.errorKey : 'internal');
    };
    setProgress(0);
    xhr.send(new FormData(form));
  }

  return (
    <form ref={formRef} onSubmit={submit} className="form form-wide uploader" aria-busy={busy}>
      {children}
      <div className="field">
        <label htmlFor={`${id}-file`}>{label}</label>
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
        <input id={`${id}-file`} name="file" type="file" accept={accept} aria-describedby={`${id}-hint`} required />
      </div>
      {busy ? (
        <p>
          <label htmlFor={`${id}-progress`}>{t('p5partner.common.uploading', { percent: progress ?? 0 })}</label>
          <progress id={`${id}-progress`} max={100} value={progress ?? 0} />
        </p>
      ) : null}
      <div role={msg?.kind === 'error' ? 'alert' : 'status'} aria-live="polite" className="form-message-slot">
        {msg ? (
          <p className={msg.kind === 'error' ? 'message message-error' : 'message message-ok'}>
            <strong>{msg.kind === 'error' ? t('common.error') : t('common.done')}: </strong>
            {msg.text}
          </p>
        ) : null}
      </div>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {button}
        </button>
      </div>
    </form>
  );
}
