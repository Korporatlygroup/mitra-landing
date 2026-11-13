import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import NewRequestForm from '@/components/sourcing/NewRequestForm';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { MY_STATES, PRODUCT_CATEGORY_SLUGS } from '@/lib/schemas';
import { getCatalogueItem } from '@/server/services/p5-buyer';
import { listSourcingPartners, listSourcingTemplates, repeatSourcingRfq } from '@/server/services/p6-sourcing';
import { requireSession } from '@/server/session';

export default async function NewSourcingPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string; repeat?: string; template?: string; org?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await requireSession({ locale, path: '/sourcing/new' });
  const t = await getTranslations({ locale, namespace: 'p6' });
  const orgs = eligibleBuyerOrgs(session.memberships).map((m) => ({ id: m.org.id, name: m.org.name }));
  const partnersResult = await listSourcingPartners(session.supabase);
  const catalogue = sp.product ? await getCatalogueItem(session.supabase, sp.product) : null;
  const repeat = sp.repeat ? await repeatSourcingRfq(session.supabase, sp.repeat) : null;
  const templateList = sp.template && sp.org && orgs.some((o) => o.id === sp.org)
    ? await listSourcingTemplates(session.supabase, sp.org) : null;
  const saved = templateList?.ok ? templateList.data.find((item) => item.id === sp.template) : null;
  const savedItems = saved && Array.isArray(saved.items) ? saved.items as Array<{
    name: string; unit: string; quantity: string; specification?: string; category_slug?: string;
  }> : null;
  const initial = repeat?.ok ? repeat.data.items.map((i) => ({
    name: i.name, unit: i.unit, quantity: String(i.quantity), category_slug: i.category_slug ?? undefined,
    specification: i.specification ?? '',
  })) : savedItems ? savedItems.map((i) => ({ name: i.name, unit: i.unit,
    quantity: String(i.quantity), category_slug: i.category_slug, specification: i.specification ?? '',
  })) : catalogue?.ok ? [{
    product_id: catalogue.data.id, name: catalogue.data.name, unit: catalogue.data.unit,
    quantity: String(catalogue.data.moq), specification: '',
  }] : undefined;
  return <main className="container">
    <h1>{t('new')}</h1>
    <p>{t('intro')}</p>
    {!orgs.length ? <p className="message message-error">
      <Link href="/orgs" locale={locale}>{t('yourBusiness')}</Link>
    </p> : !partnersResult.ok || !partnersResult.data.length ? <p className="message message-error">{t('partners')}</p> :
      <NewRequestForm locale={locale} orgs={orgs} partners={partnersResult.data} states={MY_STATES}
        categories={PRODUCT_CATEGORY_SLUGS}
        defaultOrg={saved ? sp.org : undefined}
        initial={initial} initialState={repeat?.ok ? repeat.data.state : undefined}
        initialCity={repeat?.ok ? repeat.data.city ?? undefined : undefined} />}
  </main>;
}
