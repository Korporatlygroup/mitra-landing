'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { updateNewsPrefsAction } from '@/app/[locale]/news/actions';
import { Switch } from '@/components/ui/Overlay';
import type { NewsPrefs } from '@/server/services/news';

const TOPICS = ['grants', 'training', 'deadlines', 'community'] as const;
const TOPIC_KEY = { grants: 'topicGrants', training: 'topicTraining', deadlines: 'topicDeadlines', community: 'topicCommunity' } as const;

/** "Your bulletin": one switch per topic, the weekly email switch and the language. Each change is saved at once. */
export default function BulletinPrefs({ initial }: { initial: NewsPrefs }) {
  const t = useTranslations('news2');
  const c = useTranslations('common');
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState<'saved' | 'error' | null>(null);
  const [, start] = useTransition();

  const change = (patch: Partial<NewsPrefs>) => {
    const prev = p;
    setP({ ...p, ...patch });
    setMsg(null);
    start(async () => {
      const r = await updateNewsPrefsAction(patch);
      if (r.ok) setMsg('saved');
      else {
        setP(prev);
        setMsg('error');
      }
    });
  };
  const topicsOn = TOPICS.filter((k) => p[k]).length;
  const langs = [
    ['en', c('langEn')],
    ['ta', c('langTa')],
    ['ms', c('langMs')],
  ] as const;

  return (
    <div className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ margin: 0, fontSize: '1.0625rem' }}>{t('bulletin')}</h2>
      <p className="mut" style={{ margin: '0 0 8px', fontSize: '0.875rem' }}>
        {p.weekly_email ? t('weeklyOn', { n: topicsOn }) : t('weeklyOff')}
      </p>
      <div className="sw-row">
        <span>{t('weeklySwitch')}</span>
        <Switch checked={p.weekly_email} onChange={(v) => change({ weekly_email: v })} label={t('weeklySwitch')} />
      </div>
      {TOPICS.map((k) => (
        <div key={k} className="sw-row">
          <span>{t(TOPIC_KEY[k])}</span>
          <Switch checked={p[k]} onChange={(v) => change({ [k]: v } as Partial<NewsPrefs>)} label={t(TOPIC_KEY[k])} />
        </div>
      ))}
      <div style={{ marginTop: 8 }}>
        <span className="lbl" id="bp-lang">
          {t('language')}
        </span>
        <div className="seg" role="group" aria-labelledby="bp-lang">
          {langs.map(([code, label]) => (
            <button key={code} type="button" className="seg-btn" aria-pressed={p.language === code} lang={code} onClick={() => change({ language: code })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="sr" role="status" aria-live="polite">
        {msg === 'saved' ? t('prefsSaved') : msg === 'error' ? c('error') : ''}
      </p>
      {msg === 'saved' ? <p className="mut" style={{ margin: 0, fontSize: '0.8125rem' }} aria-hidden="true">{t('prefsSaved')}</p> : null}
    </div>
  );
}
