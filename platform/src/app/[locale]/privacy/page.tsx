import LegalPage from '@/components/legal/LegalPage';
import { legalMetadata } from '@/lib/legal-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return legalMetadata((await params).locale, 'privacy');
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LegalPage locale={locale} slug="privacy" />;
}
