import { getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import SupplierWizard from '@/components/partner/SupplierWizard';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requirePartnerContext } from '@/server/partner-context';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.suppliers.addTitle');
}

export default async function NewSupplierPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '/suppliers/new');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const t = await getTranslations({ locale, namespace: 'p5partner.suppliers' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  return (
    <>
      <p>
        <Link href={`/orgs/${id}/partner/suppliers`} locale={locale}>
          {tt('backTo', { page: t('title') })}
        </Link>
      </p>
      <PageHeader title={t('addTitle')} />
      {ctx.canManageSuppliers ? <SupplierWizard locale={locale} orgId={id} detail={null} step={1} /> : <p className="message message-error">{t('readOnly')}</p>}
    </>
  );
}
