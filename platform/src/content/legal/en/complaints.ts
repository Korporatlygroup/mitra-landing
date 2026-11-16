import type { LegalDocument } from '@/lib/legal';

export const complaints: LegalDocument = {
  title: 'Complaints and Community Standards',
  intro:
    'How to report a problem on INOK, what we do with reports, and what we expect of everyone who uses the platform. This is a draft for management review and is not yet in force.',
  sections: [
    {
      id: 'report',
      title: '1. What you can report',
      blocks: [
        {
          ul: [
            'fraud or a suspicious supplier or buyer;',
            'a false or misleading business listing, or a product that is described misleadingly;',
            'abusive or threatening communication;',
            'illegal content or prohibited goods;',
            'a privacy problem or a data request (see the Privacy Notice);',
            'wrong or out-of-date government programme information;',
            'a request to correct your own listing;',
            'a dispute with a seller or buyer you met on INOK.',
          ],
        },
      ],
    },
    {
      id: 'how',
      title: '2. How to report',
      blocks: [
        {
          table: {
            head: ['What', 'How'],
            rows: [
              ['A listing, product, review or buyer request', 'Use the "Report" option on that page (you need to be signed in). Choose a reason and add a short note.'],
              ['A privacy complaint or data request', 'My account, "Your data requests", or email {privacyEmail}.'],
              ['Anything else, including fraud and disputes', 'Email {supportEmail} with the page address, the names involved and what happened. Do not send identity-card images or bank details.'],
              ['Wrong government programme information', 'Email {supportEmail} with the programme name and the correct official source.'],
            ],
          },
        },
        { note: 'Management: confirm the complaint email address and the response time targets before publication. This draft proposes an acknowledgement within 3 working days and a reply within 14 days.' },
      ],
    },
    {
      id: 'process',
      title: '3. What happens next',
      blocks: [
        { p: 'We record your report, check it against what we can see on the platform and may ask both sides for information. Reports about listings and products are reviewed by INOK staff with the right permission. We may hide or suspend content or an account while we look into it, ask a seller to correct a listing, withdraw verification, or remove the content or the account. We tell you the outcome where we can. We cannot always share details about action against another user.' },
      ],
    },
    {
      id: 'limits',
      title: '4. What INOK can and cannot do',
      blocks: [
        { p: 'INOK can moderate what appears on the platform and act on its own accounts. INOK does not receive or hold payments between buyers and sellers, so it cannot force a seller to refund, deliver or perform, and it does not guarantee any transaction. For a payment or delivery dispute, first contact the other party in writing and keep records. You may also approach the Ministry of Domestic Trade and Cost of Living (KPDN) or the Tribunal for Consumer Claims where the law gives you that right, your bank, or the police for suspected fraud.' },
      ],
    },
    {
      id: 'standards',
      title: '5. Community standards',
      blocks: [
        {
          ul: [
            'Be honest about who you are and what you offer.',
            'Be respectful. Abuse, threats and hate are not allowed.',
            'Do not post illegal, counterfeit or unsafe goods, or fake reviews.',
            'Do not collect or misuse other people\'s contact details.',
            'Keep dealings fair: do not pressure buyers to pay outside agreed terms or to share security codes.',
          ],
        },
      ],
    },
    {
      id: 'suspension',
      title: '6. Suspension and appeal',
      blocks: [
        { p: 'Where reasonable we tell you why an account or listing was suspended and how to respond. You may reply to {supportEmail} with evidence and we will review the decision again.' },
      ],
    },
    {
      id: 'authorities',
      title: '7. Escalation to authorities',
      blocks: [
        { p: 'We may report serious matters (fraud, threats, illegal goods, security incidents) to the police or other authorities, and we may respond to lawful requests from them. A personal data breach is reported to the Personal Data Protection Commissioner as the law requires.' },
      ],
    },
  ],
};
