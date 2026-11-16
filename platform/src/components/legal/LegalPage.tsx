import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getLegalContent } from '@/content/legal';
import { Link } from '@/i18n/navigation';
import { fillDocument, LEGAL_DOCS, LEGAL_STATUS, OPERATOR, type Block, type LegalSlug } from '@/lib/legal';

const NAV_KEY: Record<LegalSlug, string> = {
  privacy: 'navPrivacy',
  terms: 'navTerms',
  'marketplace-policy': 'navMarketplace',
  cookies: 'navCookies',
  'government-disclaimer': 'navGovernment',
  complaints: 'navComplaints',
};

function renderBlock(b: Block, i: number): ReactNode {
  if ('p' in b) return <p key={i}>{b.p}</p>;
  if ('note' in b)
    return (
      <p key={i} className="legal-note" role="note">
        {b.note}
      </p>
    );
  if ('ul' in b)
    return (
      <ul key={i}>
        {b.ul.map((x, j) => (
          <li key={j}>{x}</li>
        ))}
      </ul>
    );
  return (
    <div key={i} className="legal-table-wrap" tabIndex={0} role="region" aria-label={b.table.head[0]}>
      <table>
        <thead>
          <tr>
            {b.table.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.table.rows.map((r, j) => (
            <tr key={j}>
              {r.map((c, k) =>
                k === 0 ? (
                  <th key={k} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={k}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One legal document: draft banner, dates, table of contents, numbered sections. Works for signed-out visitors. */
export default async function LegalPage({ locale, slug }: { locale: string; slug: LegalSlug }) {
  const t = await getTranslations({ locale, namespace: 'legalUi' });
  const { doc: raw, translated } = getLegalContent(locale, slug);
  const doc = fillDocument(raw);
  const draft = LEGAL_STATUS === 'draft';
  return (
    <div className="legal">
      {draft ? (
        <p className="banner legal-banner" role="note" data-testid="legal-draft-banner">
          <strong>{t('draftTitle')}</strong> {t('draftBody')}
        </p>
      ) : null}
      {!translated ? (
        <p className="banner" role="note" data-testid="legal-translation-notice">
          {t('translationPending')}
        </p>
      ) : null}
      <div className="legal-grid">
        <aside className="legal-aside" aria-label={t('contents')}>
          <details className="legal-toc" open>
            <summary>{t('contents')}</summary>
            <nav aria-label={t('contents')}>
              <ol>
                {doc.sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.title.replace(/^\d+\.\s*/, '')}</a>
                  </li>
                ))}
              </ol>
            </nav>
          </details>
          <nav className="legal-others" aria-label={t('otherPolicies')}>
            <strong>{t('otherPolicies')}</strong>
            <ul>
              {LEGAL_DOCS.filter((d) => d !== slug).map((d) => (
                <li key={d}>
                  <Link href={`/${d}`} locale={locale}>
                    {t(NAV_KEY[d])}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <article className="legal-body">
          <h1>{doc.title}</h1>
          <p className="legal-dates">
            {t('effective')}: {OPERATOR.effective.startsWith('[') ? t('effectivePending') : OPERATOR.effective} · {t('updated')}: {OPERATOR.updated}
          </p>
          <p className="legal-intro">{doc.intro}</p>
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`}>{s.title}</h2>
              {s.blocks.map(renderBlock)}
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
