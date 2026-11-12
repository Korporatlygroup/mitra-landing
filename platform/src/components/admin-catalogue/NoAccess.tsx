import { getTranslations } from 'next-intl/server';

/** Shown instead of any data when the signed-in person lacks the permission for a screen. */
export default async function NoAccess({ locale, title }: { locale: string; title: string }) {
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  return (
    <>
      <h1>{title}</h1>
      <p role="alert" className="message message-error">
        <strong>{t('common.error')}: </strong>
        {t('common.noAccess')}
      </p>
    </>
  );
}
