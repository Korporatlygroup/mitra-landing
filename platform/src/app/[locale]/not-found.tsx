import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <>
      <title>{t('title')}</title>
      <h1>{t('title')}</h1>
      <p>{t('body')}</p>
      <p>
        <Link href="/" className="btn btn-secondary">
          {t('home')}
        </Link>
      </p>
    </>
  );
}
