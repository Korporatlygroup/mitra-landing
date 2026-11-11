import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/lib/metadata';
import { requirePartnerContext } from '@/server/partner-context';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.home');
}

/** Stub: the partner UI agent replaces this with the dashboard (status, next steps, counts). */
export default async function PartnerHomePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '');
  const t = await getTranslations({ locale });
  return (
    <>
      <h1>{ctx.org.name}</h1>
      <p className="muted">{t('p5partner.nav.home')}</p>
    </>
  );
}
