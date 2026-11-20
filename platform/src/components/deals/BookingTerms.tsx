import { getFormatter, getTranslations } from 'next-intl/server';

export interface BookingTermsValues {
  booking_date: string | null; completion_by: string | null; deposit_terms: string | null; cancellation_option: string | null; cancellation_text: string | null;
}

/** The terms the buyer accepts with a quotation, shown exactly as stored (date, deposit expectation, cancellation, finish-by). Nothing renders for quotations sent before booking terms existed. */
export default async function BookingTerms({ terms, headingLevel = 3, title }: { terms: BookingTermsValues; headingLevel?: 2 | 3 | 4; title?: string }) {
  if (!terms.booking_date) return null;
  const d = await getTranslations('deals');
  const fmt = await getFormatter();
  const day = (v: string) => fmt.dateTime(new Date(`${v}T00:00:00+08:00`), { dateStyle: 'long', timeZone: 'Asia/Kuala_Lumpur' });
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const cancellation = terms.cancellation_option === 'custom' ? terms.cancellation_text : terms.cancellation_option ? d(`canc_${terms.cancellation_option}`) : null;
  return (
    <section className="booking-terms" data-testid="booking-terms">
      <H>{title ?? d('termsTitle')}</H>
      <dl className="dl">
        <dt>{d('bookingDate')}</dt><dd>{day(terms.booking_date)}</dd>
        {terms.completion_by ? <><dt>{d('completionBy')}</dt><dd>{day(terms.completion_by)}</dd></> : null}
        {terms.deposit_terms ? <><dt>{d('depositTerms')}</dt><dd>{terms.deposit_terms}</dd></> : null}
        {cancellation ? <><dt>{d('cancellation')}</dt><dd>{cancellation}</dd></> : null}
      </dl>
    </section>
  );
}
