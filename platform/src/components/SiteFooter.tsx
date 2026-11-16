import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations({ locale });
  return (
    <footer className="pub-foot site-footer">
      <div className="pub-wrap">
        <span className="mut" style={{ fontSize: '0.875rem' }}>
          {t('ws.footerLine')}
        </span>
        <nav className="pub-foot-links" aria-label={t('ws.footerNav')}>
          <Link href="/terms">{t('nav.terms')}</Link>
          <Link href="/privacy">{t('nav.privacy')}</Link>
          <Link href="/marketplace-policy">{t('nav.marketplace')}</Link>
          <Link href="/cookies">{t('nav.cookies')}</Link>
          <Link href="/government-disclaimer">{t('nav.government')}</Link>
          <Link href="/complaints">{t('nav.complaints')}</Link>
        </nav>
      </div>
    </footer>
  );
}
