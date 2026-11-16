import type { LegalDocument } from '@/lib/legal';

export const privacy: LegalDocument = {
  title: 'Privacy Notice',
  intro:
    'This notice explains what personal data INOK collects, why, who can see it, where it is stored, how long we keep it and how you can exercise your rights under the Personal Data Protection Act 2010 of Malaysia. It describes what the platform actually does today. This is a draft for management and legal review and is not yet in force.',
  sections: [
    {
      id: 'operator',
      title: '1. Who we are',
      blocks: [
        { p: 'INOK ("we", "us") is operated by:' },
        {
          table: {
            head: ['Item', 'Detail'],
            rows: [
              ['Registered company name', '{company}'],
              ['SSM registration number', '{ssm}'],
              ['Registered business address', '{address}'],
              ['Privacy contact', '{privacyEmail}'],
              ['Customer support', '{supportEmail}'],
              ['Data Protection Officer', '{dpo}'],
              ['Effective date', '{effective}'],
              ['Last updated', '{updated}'],
            ],
          },
        },
        { p: 'For the personal data described in this notice we act as the data controller. Where this notice says "platform", it means the INOK website and application.' },
      ],
    },
    {
      id: 'scope',
      title: '2. Who this notice covers',
      blocks: [
        {
          ul: [
            'visitors who browse the public directory, catalogue, news and government-assistance pages without an account;',
            'registered buyers;',
            'Malaysian business owners and sellers, and the staff or managers they add to their organisation;',
            'authorised business representatives who act for an organisation;',
            'international suppliers and the partner organisations that represent them;',
            'INOK administrators and reviewers.',
          ],
        },
        { p: 'It covers personal data about individuals. Information that is only about a company (for example a business name or a product description) is business information, but it often identifies a person (for example a sole proprietor or a named contact), and we treat it with the same care where it does.' },
      ],
    },
    {
      id: 'data-collected',
      title: '3. Personal data we collect',
      blocks: [
        { p: 'We collect only what a feature needs. The table lists what the platform actually collects today.' },
        {
          table: {
            head: ['Data', 'Where it comes from', 'Required?'],
            rows: [
              ['Name (display name), email address, password (stored only as a protected hash by our authentication service), preferred language', 'You, at sign-up and in your account', 'Required to hold an account'],
              ['Acceptance records: which version of the Terms and Privacy Notice you accepted and when; optional marketing consent and its withdrawal', 'You', 'Terms and privacy: required. Marketing: optional'],
              ['Role and organisation membership (owner, manager, staff, administrator)', 'You and your organisation owner', 'Required to use organisation features'],
              ['Business details: business name, category, whether the business is registered, SSM number, business type, state, district, street address and postcode, business phone and email', 'You or your authorised representative', 'Required for a business listing and verification; the street address and contact details are kept private unless you choose to show a phone or email publicly'],
              ['Representative details: full name, role, contact phone and email of the person authorised to act for the business', 'The business', 'Required for verification'],
              ['Verification evidence: documents you upload (for example business registration, proof of location, proof of authority) and review notes and decisions', 'You and INOK reviewers', 'Required only if you ask for a verified status. Upload only what is requested. We do not need your identity-card images for this and ask you not to send them'],
              ['Listings, products, services, prices, portfolio descriptions, photos', 'Sellers and partners', 'Optional content you choose to publish'],
              ['Enquiries, messages, quotations, negotiation history, reviews, reports you file', 'Buyers and sellers', 'Created when you use these features'],
              ['Buyer requests, including contact details only if you choose to share them', 'Buyers', 'Contact sharing is optional'],
              ['Sourcing records: items, quantities, notes, quotes, counter-offers, sample requests, messages and attachments', 'Buyers and international suppliers or partners', 'Created when you use sourcing'],
              ['Supplier records: supplier name, private contact name, email and phone, registration identifier, website, capabilities, supporting documents', 'Partners and suppliers', 'Required to list a supplier'],
              ['Government-assistance information: business needs, registration and citizenship status as you enter them, saved programmes, your notes and application-tracking status, reminder preferences', 'You', 'Optional; used only to guide you'],
              ['Notification and news preferences, in-app notifications', 'You and the system', 'Optional preferences'],
              ['Security and audit records: sign-in, sign-out, password-change and administrative actions with time and account; rate-limit counters used to stop abuse', 'The system', 'Created automatically'],
              ['Technical data: the platform does not itself store IP addresses in its database. Our hosting provider processes IP address and request metadata to deliver the site and protect it (see section 7)', 'Your device', 'Created automatically'],
            ],
          },
        },
        { p: 'We do not knowingly collect biometric data, bank-card numbers or passwords for other services. Please do not include them in messages, notes or uploads.' },
      ],
    },
    {
      id: 'purposes',
      title: '4. Why we use your data',
      blocks: [
        {
          table: {
            head: ['Purpose', 'Basis'],
            rows: [
              ['Create and secure your account; sign you in; recover your password; keep sessions safe', 'Needed to provide the service you asked for'],
              ['Business onboarding, listing and discovery; showing the public parts of your profile', 'Needed to provide the service; you choose what becomes public'],
              ['Verification of a business and its representative; administrative review and moderation', 'Needed to provide the service; legitimate interest in a trustworthy marketplace; legal obligations'],
              ['Buyer-seller communication, quotations, supplier matching and sourcing workflows', 'Needed to provide the service you requested'],
              ['Government-assistance matching, saved programmes and application tracking', 'Your request; the information you enter is optional'],
              ['Fraud prevention, abuse control, security monitoring and incident response', 'Legitimate interest; legal obligations'],
              ['Customer support and handling of complaints and data requests', 'Needed to respond to you'],
              ['Service improvement from aggregated or de-identified counts', 'Legitimate interest'],
              ['Optional marketing messages about INOK', 'Your consent, which is never pre-selected and can be withdrawn at any time'],
              ['Keeping records that law requires (see section 10)', 'Legal obligation'],
            ],
          },
        },
        { note: 'Management note: the Personal Data Protection Act 2010 is built on consent and a list of permitted grounds rather than the lawful-basis model of other laws. The "basis" column is a plain-language mapping for review by counsel, not a legal opinion.' },
      ],
    },
    {
      id: 'sources',
      title: '5. Where the information comes from',
      blocks: [
        {
          ul: [
            'directly from you;',
            'from an authorised representative or a colleague who adds you to an organisation or an invitation;',
            'from other participants, for example a buyer who sends you an enquiry or a reviewer who records a decision;',
            'from documents you upload;',
            'from your activity on the platform (messages, quotations, saved items, audit records);',
            'from public business information that a seller chooses to publish;',
            'from official government programme sources for the Government Assistance pages. These describe programmes, not individuals.',
          ],
        },
        { p: 'We do not buy personal data or combine it with external advertising profiles.' },
      ],
    },
    {
      id: 'sharing',
      title: '6. Who can see your information',
      blocks: [
        { p: 'Some information is public, some is shared with the other party in a transaction, and some is private. We do not sell personal data.' },
        {
          table: {
            head: ['Who', 'What they can see'],
            rows: [
              ['Anyone (public)', 'The parts of a business listing and product page that the seller published: business name, description, category, state, products and, only if the seller chooses, a business phone or email. Approved reviews. Public programme information.'],
              ['The other party in an enquiry, quotation, request or sourcing thread', 'The messages, quotations and attachments in that thread and the contact details you choose to share with it. A buyer who sends an enquiry necessarily shares the enquiry with the seller; a seller who answers a request necessarily shares the answer with the buyer.'],
              ['Partners and international suppliers you are matched with', 'The sourcing request details you send them. If you include personal details, they receive them. See section 8.'],
              ['Your organisation', 'Owners and managers can see members, roles and organisation records according to their role.'],
              ['Authorised INOK staff', 'Only what their role needs: reviewers see verification evidence; administrators with the matching permission handle reports and data requests. Administrative accounts require a second authentication step and their actions are logged.'],
              ['Service providers (processors)', 'Cloudflare (hosting and delivery) and Supabase (database, authentication, private file storage). A transactional email provider will be added when email is launched; this notice will be updated before then.'],
              ['Authorities', 'Where the law requires it or a competent authority lawfully asks, and to protect rights, safety or against fraud.'],
            ],
          },
        },
        { p: 'Private account information (your email address, password hash, verification documents, private business address and private contact details) is not shown to other users, except where you choose to share it.' },
      ],
    },
    {
      id: 'transfers',
      title: '7. Transfers outside Malaysia',
      blocks: [
        { p: 'Your data is processed outside Malaysia:' },
        {
          ul: [
            'Our production database, authentication service and private file storage are hosted by Supabase in Tokyo, Japan (AWS ap-northeast-1).',
            'The application runs on Cloudflare\'s global network, which processes requests (including IP addresses) in the data centre nearest to the visitor.',
            'International suppliers and partners may be located in other countries, for example India (see section 8).',
          ],
        },
        { p: 'Under the Personal Data Protection Act 2010 as amended in 2024, a data controller may transfer personal data abroad if the destination has laws substantially similar to the Act or ensures an adequate level of protection, or another condition in the Act is met. The Commissioner has issued guidance on cross-border transfers. {company} has not yet completed its transfer assessment for Japan, Cloudflare\'s locations and supplier countries, and has not yet signed processor terms recorded for review. We will not describe the transfers as compliant until that assessment is done.' },
        { note: 'Management action: complete the transfer assessment and confirm the processor agreements (Supabase, Cloudflare). See the legal applicability matrix.' },
      ],
    },
    {
      id: 'international-suppliers',
      title: '8. International suppliers and sourcing partners',
      blocks: [
        { p: 'When a buyer sends a sourcing request or enquiry to a partner or an international supplier, the recipient receives what is in the request: the items, quantities, notes, any attachment and the name of the buyer organisation. If a buyer writes personal details into a note, the recipient receives them. Recipients decide how they use that information for their own business and are responsible for handling it lawfully in their country. INOK does not control a recipient\'s systems. Buyers should send only what a supplier needs to quote.' },
      ],
    },
    {
      id: 'security',
      title: '9. How we protect data (what is in place today)',
      blocks: [
        {
          ul: [
            'Sign-in with passwords of at least 10 characters including upper-case, lower-case and a digit; sign-in attempts are rate-limited;',
            'a second authentication step (authenticator app) is required for administrator and reviewer accounts and is available to everyone;',
            'role-based access and row-level security in the database, so each organisation\'s records are isolated from others, tested automatically;',
            'private storage for verification documents: no public links, short-lived access only for authorised people;',
            'uploaded files are type- and size-checked; files that have not been scanned for malware are held in quarantine and cannot be approved or downloaded. A malware scanner is not yet operational, so document-based verification is not yet open;',
            'encrypted connections (HTTPS) for all traffic;',
            'an audit log of sign-ins and administrative actions, kept in a form that staff cannot edit;',
            'separate staging and production systems with separate databases and secrets.',
          ],
        },
        { p: 'We do not promise that any system is perfectly secure. We have not obtained an external security certification. The production database is on a plan without automatic backups at the time of writing; we keep manual, tested backups (see section 10) and will update this notice if that changes.' },
        { p: 'If a personal data breach occurs we will assess it, notify the Personal Data Protection Commissioner as the law requires and tell affected people where the breach is likely to cause significant harm.' },
      ],
    },
    {
      id: 'retention',
      title: '10. How long we keep data (proposed, for management approval)',
      blocks: [
        { p: 'The law prescribes a period for only some records. Where it does not, the period below is a proposal with its reason. It is not an approved retention schedule until management confirms it.' },
        {
          table: {
            head: ['Category', 'Proposed period', 'Reason'],
            rows: [
              ['Account data (name, email, preferences)', 'While the account is open; deleted or anonymised within 30 days after a verified closure request, subject to the rows below', 'No longer needed once the account is closed'],
              ['Business profile and listing', 'While active; removed from public view on closure; private details deleted after the supplier-record period below', 'Service delivery'],
              ['Marketplace and supplier records (identity and contact details, business account details, registration number, transaction and advertising records)', '3 years', 'Consumer Protection (Electronic Trade Transaction) Regulations 2024, regulation 8, require marketplace operators to keep supplier records for three years'],
              ['Quotations and sourcing records', '3 years after the last activity', 'Evidence for disputes and the supplier-record rule'],
              ['Messages (enquiries, sourcing)', '3 years after the thread closes', 'Evidence for disputes; proposed'],
              ['Verification documents and review decisions', 'Documents: deleted 12 months after the verification ends or the account closes, unless a dispute or legal request requires longer; the decision record: 3 years', 'Minimise sensitive evidence; proposed'],
              ['Security and audit logs', '24 months', 'Investigation and breach-record needs; proposed. Breach notification records are kept at least 2 years under the Commissioner\'s Circular 2/2025'],
              ['Government programme tracking (saved programmes, notes)', 'While the account is open; deleted with it', 'Personal planning aid'],
              ['Support requests and data requests', '3 years after closure', 'Show that requests were answered; proposed'],
              ['Backups', 'Manual backups are kept up to 90 days then destroyed; deletions reach backups on that cycle', 'Recovery; proposed'],
              ['Marketing consent records', 'For as long as needed to prove consent or its withdrawal', 'Accountability'],
            ],
          },
        },
      ],
    },
    {
      id: 'rights',
      title: '11. Your rights and how to use them',
      blocks: [
        { p: 'Under the Personal Data Protection Act 2010 you may:' },
        {
          ul: [
            'ask for access to the personal data we hold about you;',
            'ask us to correct it if it is inaccurate, incomplete or out of date;',
            'ask us to limit or stop processing, or withdraw a consent you gave (for example marketing) at any time;',
            'ask us to transmit your personal data to another controller of your choice where technically feasible (data portability, introduced by the 2024 amendment, subject to the period and rules the Commissioner prescribes);',
            'ask us to delete data that is no longer needed. Deletion is not always possible: we must keep what the law requires (section 10) and what is needed for an open dispute or investigation;',
            'complain to us, and to the Personal Data Protection Commissioner.',
          ],
        },
        { p: 'Signed-in users can send a request from My account, under "Your data requests". Others can email {privacyEmail}. We will check who you are, record the request, and aim to reply within 21 days. We may refuse a request in the cases the Act allows and will explain why.' },
      ],
    },
    {
      id: 'marketing',
      title: '12. Messages we send you',
      blocks: [
        {
          table: {
            head: ['Type', 'Examples', 'Can you opt out?'],
            rows: [
              ['Essential account and security messages', 'Email confirmation, password recovery, security notices, changes to these terms', 'No: they are needed to run your account'],
              ['Transaction-related notifications', 'A reply to your enquiry, a quotation, a verification decision, a reminder you asked for', 'You can control some in your notification preferences'],
              ['Optional marketing', 'News about INOK features and offers', 'Yes. Never switched on for you. Tick the box at sign-up or in My account, and untick it at any time'],
            ],
          },
        },
        { p: 'Refusing marketing never limits your access to the platform. Email delivery is not yet active; no email of any kind is sent until the email service is launched.' },
      ],
    },
    {
      id: 'cookies',
      title: '13. Cookies',
      blocks: [{ p: 'We use only the cookies needed to sign you in and remember your language. We do not use advertising or analytics cookies. Details are in the Cookie Policy.' }],
    },
    {
      id: 'age',
      title: '14. Children and eligibility',
      blocks: [
        { p: 'INOK is a business platform. [Minimum account age: to be confirmed by management; this draft proposes 18 years, or the age of majority needed to enter a binding contract.] We do not knowingly collect personal data from children. If you believe a child has given us data, contact {privacyEmail} and we will remove it.' },
      ],
    },
    {
      id: 'complaints',
      title: '15. Privacy complaints',
      blocks: [
        { p: 'Send a complaint to {privacyEmail} (or use "Your data requests" in My account, choosing "Complaint"). We will acknowledge it, investigate and reply in writing. If you remain unsatisfied you may contact the Personal Data Protection Commissioner of Malaysia (Jabatan Perlindungan Data Peribadi).' },
      ],
    },
    {
      id: 'changes',
      title: '16. Changes to this notice',
      blocks: [
        { p: 'We will post the updated notice with a new "last updated" date. For material changes we will tell signed-in users before they take effect and, where the law or the change requires it, ask for acceptance again. The version you accepted is recorded against your account.' },
      ],
    },
  ],
};
