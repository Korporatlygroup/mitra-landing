'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { saveNewsPostAction } from '@/app/[locale]/admin/news/actions';
import { FormMessage, useRestoringAction } from '@/components/ActionForm';
import type { NewsCategory } from '@/server/services/news';

export interface EditorPost {
  id: string | null;
  version: number | null;
  title: string;
  summary: string;
  body: string;
  category: NewsCategory;
  language: 'en' | 'ta' | 'ms';
  deadline_on: string;
  publish_at: string;
  sectors: string[];
  states: string[];
  status: 'draft' | 'published' | 'archived' | 'new';
}

function Btn({ intent, kind, children }: { intent: string; kind: 'primary' | 'secondary' | 'danger'; children: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value={intent} className={`btn btn-${kind}`} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}

/** Editor for one news post: text, category, language, deadline, who it is for, and publish / schedule / draft / archive. */
export default function NewsEditor({ post, categories, states, sectorLabels }: { post: EditorPost; categories: { value: NewsCategory; label: string }[]; states: string[]; sectorLabels: { slug: string; label: string }[] }) {
  const t = useTranslations('news2.admin');
  const c = useTranslations('common');
  const locale = useLocale();
  const [state, action, formRef] = useRestoringAction(saveNewsPostAction);
  return (
    <form ref={formRef} action={action} className="form form-wide" style={{ maxWidth: '46rem' }}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={post.id ?? ''} />
      <input type="hidden" name="version" value={post.version ?? ''} />
      <div className="field">
        <label htmlFor="np-title">{t('fTitle')}</label>
        <input id="np-title" name="title" type="text" required minLength={3} maxLength={160} defaultValue={post.title} />
      </div>
      <div className="field">
        <label htmlFor="np-summary">{t('fSummary')}</label>
        <textarea id="np-summary" name="summary" rows={2} required minLength={10} maxLength={400} defaultValue={post.summary} />
      </div>
      <div className="field">
        <label htmlFor="np-body">{t('fBody')}</label>
        <textarea id="np-body" name="body" rows={10} required minLength={10} maxLength={20000} defaultValue={post.body} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="np-cat">{t('fCategory')}</label>
          <select id="np-cat" name="category" defaultValue={post.category}>
            {categories.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="np-lang">{t('fLanguage')}</label>
          <select id="np-lang" name="language" defaultValue={post.language}>
            <option value="en">{c('langEnFull')}</option>
            <option value="ta">{c('langTaFull')}</option>
            <option value="ms">{c('langMsFull')}</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="np-deadline">{t('fDeadline')}</label>
          <input id="np-deadline" name="deadline_on" type="date" defaultValue={post.deadline_on} />
        </div>
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="np-pub">{t('fPublishAt')}</label>
          <input id="np-pub" name="publish_at" type="datetime-local" defaultValue={post.publish_at} />
        </div>
      </div>
      <fieldset>
        <legend>{t('fSectors')}</legend>
        <p className="hint">{t('allHint')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))', gap: 4 }}>
          {sectorLabels.map((s) => (
            <label key={s.slug} className="radio" style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="sectors" value={s.slug} defaultChecked={post.sectors.includes(s.slug)} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('fStates')}</legend>
        <p className="hint">{t('allHint')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: 4 }}>
          {states.map((s) => (
            <label key={s} className="radio" style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="states" value={s} defaultChecked={post.states.includes(s)} />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage state={state} />
      <div className="btn-row">
        <Btn intent="save" kind="secondary">
          {t('save')}
        </Btn>
        <Btn intent="publish" kind="primary">
          {t('publish')}
        </Btn>
        {post.status === 'published' ? (
          <Btn intent="draft" kind="secondary">
            {t('unpublish')}
          </Btn>
        ) : null}
        {post.id && post.status !== 'archived' ? (
          <Btn intent="archive" kind="danger">
            {t('archive')}
          </Btn>
        ) : null}
      </div>
    </form>
  );
}
