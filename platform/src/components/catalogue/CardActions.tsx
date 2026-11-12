import { getTranslations } from 'next-intl/server';
import { saveProductAction, unsaveProductAction } from '@/app/[locale]/catalogue/actions';
import { Link } from '@/i18n/navigation';
import { CompareToggle } from './CompareControls';
import QuickForm from './QuickForm';

/**
 * Save, Compare and Request Price for one product (buyer pages). Anonymous visitors get a sign-in link that comes back to
 * `nextPath` (full path with locale); Save is a real form for signed-in buyers and shows the saved state from the database.
 */
export default async function CardActions({
  id,
  name,
  locale,
  signedIn,
  saved,
  nextPath,
  compare = true,
  request = true,
}: {
  id: string;
  name: string;
  locale: string;
  signedIn: boolean;
  saved: boolean;
  nextPath: string;
  compare?: boolean;
  request?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  return (
    <>
      {compare ? <CompareToggle id={id} name={name} /> : null}
      <div className="catalogue-action-row">
        {signedIn ? (
          saved ? (
            <QuickForm action={unsaveProductAction} fields={{ locale, productId: id }} label={t('save.remove')} srName={name} />
          ) : (
            <QuickForm action={saveProductAction} fields={{ locale, productId: id }} label={t('save.save')} srName={name} />
          )
        ) : (
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} locale={locale} className="btn btn-secondary">
            {t('save.signInToSave')}
          </Link>
        )}
        {request ? (
          <Link href={`/catalogue/${id}/request`} locale={locale} className="btn btn-primary" aria-label={`${tc('buttons.requestPrice')}: ${name}`}>
            {tc('buttons.requestPrice')}
          </Link>
        ) : null}
      </div>
    </>
  );
}
