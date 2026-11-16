import LegalPage from '@/components/legal/LegalPage';
import { legalMetadata } from '@/lib/legal-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return legalMetadata((await params).locale, 'complaints');
}

export default async function ComplaintsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LegalPage locale={locale} slug="complaints" />;
}
