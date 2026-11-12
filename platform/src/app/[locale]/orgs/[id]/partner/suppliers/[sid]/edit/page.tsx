import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import PartnerGate from '@/components/partner/PartnerGate';
import SupplierWizard, { SUPPLIER_STEPS } from '@/components/partner/SupplierWizard';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { supplierEditable, supplierUnderReview } from '@/lib/partner-ui';
import { uuidSchema } from '@/lib/schemas';
import { requirePartnerContext } from '@/server/partner-context';
import { getSupplier } from '@/server/services/p5-partner';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.suppliers.editTitle');
}

export default async function EditSupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string; sid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id, sid } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(sid).success) notFound();
  const raw = Number(typeof sp.step === 'string' ? sp.step : '1');
  const step = Number.isInteger(raw) && raw >= 1 && raw <= SUPPLIER_STEPS ? raw : 1;
  const ctx = await requirePartnerContext(locale, id, `/suppliers/${sid}/edit?step=${step}`);
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const r = await getSupplier(ctx.session.supabase, sid);
  if (!r.ok || r.data.partner_org_id !== id) notFound();
  const d = r.data;
  const t = await getTranslations({ locale, namespace: 'p5partner.suppliers' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const editable = ctx.canManageSuppliers && supplierEditable(d.status, supplierUnderReview(d));
  return (
    <>
      <p>
        <Link href={`/orgs/${id}/partner/suppliers/${sid}`} locale={locale}>
          {tt('backTo', { page: d.name ?? t('unnamed') })}
        </Link>
      </p>
      <h1>{t('editTitle')}</h1>
      {sp.saved ? (
        <p className="message message-ok" role="status">
          {tt('saved')}
        </p>
      ) : null}
      {editable ? (
        <SupplierWizard locale={locale} orgId={id} detail={d} step={step} />
      ) : (
        <p className="message message-error" role="alert" data-testid="not-editable">
          {ctx.canManageSuppliers ? t('notEditable') : t('readOnly')}
        </p>
      )}
    </>
  );
}
