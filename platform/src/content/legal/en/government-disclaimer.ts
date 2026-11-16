import type { LegalDocument } from '@/lib/legal';

export const governmentDisclaimer: LegalDocument = {
  title: 'Government Assistance Notice',
  intro:
    'The Government Assistance Navigator helps small businesses find public programmes. It is guidance, not an application, an approval or an official decision. This is a draft for management review and is not yet in force.',
  sections: [
    {
      id: 'independent',
      title: '1. INOK is independent',
      blocks: [
        { p: 'INOK is not a government agency and is not automatically affiliated with, endorsed by or acting for any ministry, agency or programme shown on these pages. Names of agencies and programmes are used only to say what they are. Agency logos or crests are not shown unless the agency has given written permission.' },
      ],
    },
    {
      id: 'sources',
      title: '2. Where the information comes from',
      blocks: [
        { p: 'Programme information is taken from the official sources linked on each programme page. People at INOK review each record against its official source before it is published. Records that have not been verified are not published as active.' },
      ],
    },
    {
      id: 'changes',
      title: '3. Requirements change',
      blocks: [
        { p: 'Eligibility rules, amounts, dates and documents can change without notice. Each programme page shows the date we last verified it. Application dates and availability must be checked with the agency before you rely on them. When we cannot confirm that a programme is still open, we show its status as unknown.' },
      ],
    },
    {
      id: 'matching',
      title: '4. Matching results are preliminary guidance',
      blocks: [
        { p: 'The finder compares what you tell it with published programme criteria. A match, or a high ranking, is not a decision on your eligibility and does not mean you will qualify, be approved or receive funding. Not matching is not a refusal either.' },
      ],
    },
    {
      id: 'apply',
      title: '5. Apply only through the official channel',
      blocks: [
        { p: 'Applications are submitted to the responsible agency through its official channel, using the official link on the programme page. The agency makes the final decision. INOK does not approve grants, issue government financing, or act on your behalf with an agency.' },
        { p: 'INOK does not charge any official government application fee on an agency\'s behalf and does not ask you to pay to be considered for a government programme, unless a specific service is described and authorised in writing. Be careful of anyone who asks you for money to "guarantee" an approval.' },
      ],
    },
    {
      id: 'each-programme',
      title: '6. What every programme page shows',
      blocks: [
        {
          ul: [
            'the responsible agency and the programme name;',
            'the type of assistance and the intended beneficiary;',
            'the official source and the last verified date;',
            'the application deadline, or that it is unknown;',
            'the requirements, as published by the agency;',
            'the official application link;',
            'this notice: INOK is not affiliated with the agency and does not decide eligibility.',
          ],
        },
      ],
    },
    {
      id: 'corrections',
      title: '7. Corrections and reports',
      blocks: [
        { p: 'We correct or remove information that is out of date. If you see a mistake, please write to {supportEmail} with the programme name and the correct official source. Saved programmes, notes and tracking are private to your organisation.' },
      ],
    },
  ],
};
