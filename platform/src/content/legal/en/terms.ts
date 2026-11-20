import type { LegalDocument } from '@/lib/legal';

export const terms: LegalDocument = {
  title: 'Terms of Service',
  intro:
    'These terms govern your use of INOK. INOK is primarily a platform for business discovery, communication and sourcing. It is not a shop, a payment service or an escrow service. This is a draft for management and legal review and is not yet in force.',
  sections: [
    {
      id: 'operator',
      title: '1. The platform operator',
      blocks: [
        { p: 'INOK is operated by {company}, SSM registration number {ssm}, of {address} ("INOK", "we", "us"). Contact: {supportEmail}. Effective date: {effective}. Last updated: {updated}.' },
      ],
    },
    {
      id: 'definitions',
      title: '2. Definitions',
      blocks: [
        {
          ul: [
            '"Platform" means the INOK website and application.',
            '"User" means anyone who uses the platform.',
            '"Buyer" means a user who looks for goods or services, sends enquiries, requests, or sourcing requests.',
            '"Seller" or "Business" means a Malaysian business that lists itself, products or services.',
            '"Partner" and "International Supplier" mean an organisation that offers goods or services, including from outside Malaysia, through the sourcing tools.',
            '"Organisation" means a business, partner or buyer account that has members.',
            '"Content" means anything a user submits: listings, descriptions, messages, quotations, files, reviews and reports.',
            '"Marketplace Policy" means the Buyer, Seller and Supplier Policy published with these terms.',
          ],
        },
      ],
    },
    {
      id: 'services',
      title: '3. What INOK provides',
      blocks: [
        { p: 'INOK provides: a public business directory and product catalogue; tools to send enquiries, requests and quotation requests; messaging between buyers and sellers; quotation and negotiation records; supplier sourcing workflows; business verification review; and a Government Assistance Navigator that explains public programmes. INOK helps parties find each other and record what they say to each other.' },
        { p: 'INOK is not a party to any contract between users. INOK does not sell, deliver or inspect goods, does not take payment for them and does not supply government financing.' },
      ],
    },
    {
      id: 'eligibility',
      title: '4. Who can open an account',
      blocks: [
        { p: 'You must be at least [minimum age: to be confirmed by management; draft proposes 18] years old and able to enter a binding contract, or act for an organisation that can. If you act for an organisation you confirm that you are authorised to do so (see section 10).' },
      ],
    },
    {
      id: 'registration',
      title: '5. Registration and accuracy',
      blocks: [
        { p: 'You must give accurate, current information and keep it up to date. You may hold only accounts that you are entitled to hold. We may refuse or close a registration that is inaccurate, duplicated or abusive.' },
      ],
    },
    {
      id: 'account-security',
      title: '6. Keeping your account secure',
      blocks: [
        { p: 'Keep your password confidential, use a strong password and turn on the authenticator step where offered (it is required for administrators). Tell us promptly at {supportEmail} if you think your account has been used without your permission. You are responsible for activity under your account unless it results from our failure to take reasonable care.' },
      ],
    },
    {
      id: 'buyers',
      title: '7. Buyer responsibilities',
      blocks: [
        { p: 'Buyers must send genuine, accurate enquiries and requests; communicate respectfully; use quotations and sourcing tools for real purchasing intentions; and not use the platform for fraud, harassment or to harvest contact details. See the Marketplace Policy.' },
      ],
    },
    {
      id: 'sellers',
      title: '8. Seller responsibilities',
      blocks: [
        { p: 'Sellers must keep their profile, prices and descriptions accurate; hold the licences and registrations their business needs; answer enquiries promptly and honestly; and fulfil what they commit to. Sellers who trade through the platform must also meet the disclosure duties that apply to online marketplace suppliers. See the Marketplace Policy.' },
      ],
    },
    {
      id: 'suppliers',
      title: '9. International supplier responsibilities',
      blocks: [
        { p: 'International suppliers and partners must give accurate company and product information, state their quotation terms and any extra charges clearly, and remain responsible for shipping, delivery, customs and import or export documents, product standards and payment arrangements that they agree with the buyer. See the Marketplace Policy.' },
      ],
    },
    {
      id: 'authority',
      title: '10. Acting for a business',
      blocks: [
        { p: 'If you create or manage an organisation you promise that you have the authority to bind it and to give us the information you provide. We may ask for evidence of authority. A person who claims authority they do not have may be removed and reported.' },
      ],
    },
    {
      id: 'verification',
      title: '11. Business verification and its limits',
      blocks: [
        { p: 'Verification is a review by INOK of the information and documents a business submits. A "verified" label means that on the date of review the evidence provided was found consistent. It is not a guarantee of the business\'s quality, solvency, licences, products or conduct, and it is not an endorsement. Verification can be withdrawn. Until the document scanner is operational, document-based verification is not available.' },
      ],
    },
    {
      id: 'listings',
      title: '12. Business listings',
      blocks: [
        { p: 'A listing is published only after review and stays the seller\'s responsibility. A seller chooses whether a phone number or email is shown publicly. We do not change your listing content without telling you, but we may decline, hide or remove a listing that breaks these terms or the law.' },
      ],
    },
    {
      id: 'descriptions',
      title: '13. Product and service descriptions',
      blocks: [
        { p: 'Descriptions, images and prices must be truthful and not misleading, and must not claim approvals, certifications or standards the seller does not hold. Information that is required by law for the goods or services must be shown, and in the national language where the law requires.' },
      ],
    },
    {
      id: 'enquiries',
      title: '14. Enquiries and quotation requests',
      blocks: [
        { p: 'An enquiry or request invites a reply. It is not an order. The seller is not obliged to reply or to quote, and the buyer is not obliged to buy.' },
      ],
    },
    {
      id: 'quotations',
      title: '15. Quotations, negotiation and acceptance',
      blocks: [
        { p: 'A quotation states what a seller offers, with its validity period. For work or goods with a date, a quotation also states the booking terms the buyer is asked to accept: the service or delivery date, an optional finish-by date, a deposit expectation and the cancellation conditions (one of three standard options, or the seller\'s own wording). The deposit expectation is written text only.' },
        { p: 'The platform records each version, change request and the buyer\'s acceptance. A buyer can ask for changes and the seller can send a new version; only the latest version can be accepted, and earlier versions stay on record unchanged.' },
        { p: 'Accepting a quotation creates an agreement record on the platform containing exactly the terms that were accepted. Where the quotation had booking terms, those terms are locked: neither side can edit them on the platform afterwards. A change needs a new quotation, so cancel the agreement first if both sides agree. Agreements created before booking terms existed may still have a date or deposit note added by the seller.' },
        { p: 'An agreement record is not a receipt, an invoice, proof of payment, proof of delivery or an INOK guarantee. The supply of the goods or services, delivery and payment happen between the parties outside the platform. Check the final price, taxes and delivery cost before you accept.' },
      ],
    },
    {
      id: 'agreements',
      title: '15A. Order progress and cancellation',
      blocks: [
        { p: 'After acceptance an agreement moves through these steps on the platform: agreed; work started (marked by the seller); delivered, waiting for the buyer\'s confirmation (marked by the seller with a note); completed (confirmed by the buyer); or cancelled. Either side may cancel while the agreement is still only "agreed", and may add a note.' },
        { p: 'The cancellation conditions and any deposit expectation in the quotation are arrangements between the buyer and the seller. INOK does not apply, calculate, collect, hold, return or confirm any deposit or fee, and the platform never marks an agreement as paid or protected. Confirming delivery records the buyer\'s confirmation only; it is not proof of quality or of payment.' },
      ],
    },
    {
      id: 'sourcing',
      title: '16. Supplier sourcing workflows',
      blocks: [
        { p: 'Sourcing tools let a buyer send a request to chosen partners, receive quotes and counter-offers, request samples and choose a preferred quote. A preferred selection is a record of the buyer\'s choice. It is not a contract by INOK and does not oblige INOK to anything.' },
      ],
    },
    {
      id: 'delivery',
      title: '17. Delivery and fulfilment',
      blocks: [
        { p: 'Delivery, installation, returns, warranties and after-sales service are the responsibility of the seller or supplier and are governed by the agreement between buyer and seller. INOK does not ship, hold or inspect goods.' },
      ],
    },
    {
      id: 'payments',
      title: '18. Payments',
      blocks: [
        { p: 'INOK does not currently process payments. Any payment is arranged directly between buyer and seller outside the platform. Take care when paying, check who you are paying, and keep records.' },
        { p: 'A deposit expectation or cancellation condition written in a quotation is text agreed between the parties. INOK does not collect, hold, track or confirm any deposit or payment.' },
      ],
    },
    {
      id: 'no-escrow',
      title: '19. No escrow and no payment guarantee',
      blocks: [
        { p: 'INOK does not provide escrow, payment protection, a refund guarantee or insurance. INOK cannot compel a seller to refund, deliver or perform, and does not guarantee that a transaction will succeed. If INOK later offers a payment feature, separate terms will apply and this section will be updated.' },
      ],
    },
    {
      id: 'no-outcomes',
      title: '20. No guaranteed results',
      blocks: [
        { p: 'INOK does not promise leads, sales, orders, financing, grants, loans, approvals or any business result. Examples shown on the platform are illustrations, not promises.' },
      ],
    },
    {
      id: 'prohibited',
      title: '21. Prohibited conduct and listings',
      blocks: [
        {
          ul: [
            'goods or services that are illegal, counterfeit, stolen, unsafe or require a licence the seller does not hold;',
            'misleading, deceptive or fraudulent offers, fake reviews or fake businesses;',
            'impersonating a person or business, or claiming government endorsement that does not exist;',
            'sending malware, scraping data, probing or bypassing security, or overloading the platform;',
            'collecting or misusing other users\' personal data;',
            'harassment, hate speech or abuse;',
            'taking users off the platform to avoid its rules in order to defraud them.',
          ],
        },
      ],
    },
    {
      id: 'content',
      title: '22. Content you submit',
      blocks: [
        { p: 'You keep ownership of your content. You give INOK a non-exclusive, royalty-free licence to host, display, copy and process it as needed to run the platform for you and for the users you choose to share it with, and (for public listings) to show it publicly while it is published. You promise that you have the right to submit it and that it does not infringe anyone\'s rights or the law. We may remove content that breaks these terms.' },
      ],
    },
    {
      id: 'ip',
      title: '23. Intellectual property',
      blocks: [
        { p: 'The platform, its design, the INOK name and logo and our own text belong to {company} or its licensors. You may not copy or reuse them except as these terms allow. Names and logos of government agencies belong to those agencies and are not licensed to you or to INOK by these terms.' },
      ],
    },
    {
      id: 'complaints',
      title: '24. Complaints and reporting',
      blocks: [
        { p: 'You can report a listing, product, review or request from the page where you see it (when signed in), and send any complaint to {supportEmail}. Our process is in the Complaints and Community Standards page.' },
      ],
    },
    {
      id: 'order-issues',
      title: '24A. Reporting an issue with an agreement',
      blocks: [
        { p: 'While work is in progress or waiting for confirmation, the buyer can report an issue on the agreement by choosing a reason (not delivered, not as agreed, the other side did not turn up, or something else) and describing what happened. The seller is told, the report is recorded on the agreement, and authorised INOK staff can see it in a read-only list.' },
        { p: 'INOK does not decide who is right, does not hold or move money and cannot order a refund, delivery or performance. Reporting an issue on the platform is not a legal claim and does not replace your other remedies (see section 24 and the Complaints and Community Standards page).' },
      ],
    },
    {
      id: 'suspension',
      title: '25. Suspension and termination',
      blocks: [
        { p: 'We may suspend or end an account, remove content or withdraw verification if you break these terms or the law, if we must by law, or to protect users. Where reasonable we will tell you why and how to respond. You may close your account at any time from a data request or by contacting us; records we must keep stay as described in the Privacy Notice.' },
      ],
    },
    {
      id: 'data-protection',
      title: '26. Personal data',
      blocks: [{ p: 'Our Privacy Notice explains how we handle personal data and your rights. You must handle other people\'s personal data that you receive through the platform (for example a buyer\'s or supplier\'s contact details) lawfully and only for the purpose it was provided.' }],
    },
    {
      id: 'incidents',
      title: '27. Security incidents',
      blocks: [{ p: 'Report suspected security problems or unauthorised access to {supportEmail}. We will investigate, take steps to contain the problem and notify authorities and affected people where the law requires.' }],
    },
    {
      id: 'availability',
      title: '28. Availability',
      blocks: [{ p: 'We aim to keep the platform available but do not promise it will be uninterrupted or error-free. We may suspend features for maintenance, security or legal reasons. Some features (for example email notifications and document upload) may not yet be active.' }],
    },
    {
      id: 'links',
      title: '29. Third-party links',
      blocks: [{ p: 'The platform links to government and other websites that we do not control. We are not responsible for their content or practices. Always use official channels for official applications.' }],
    },
    {
      id: 'disclaimers',
      title: '30. Disclaimers',
      blocks: [
        { p: 'Subject to section 31 and to rights that the law gives you and that cannot be excluded, the platform is provided "as is" and "as available". Users, not INOK, supply listings, quotations and information, and INOK does not warrant that they are accurate, lawful or suitable.' },
      ],
    },
    {
      id: 'liability',
      title: '31. Liability',
      blocks: [
        { p: 'Nothing in these terms excludes or limits any liability or right that cannot lawfully be excluded or limited under Malaysian law, including rights a consumer has under the Consumer Protection Act 1999. [Management and counsel to decide the extent of the limitation of INOK\'s liability for business users, which must be reasonable and lawful.]' },
      ],
    },
    {
      id: 'disputes',
      title: '32. Disputes',
      blocks: [
        { p: 'Disputes between users are matters between those users. INOK may help communicate but cannot decide them. For a dispute with INOK, first write to {supportEmail}; we will try to resolve it in good faith. [Mediation or arbitration clause: to be decided by management and counsel.] Consumers keep their right to use the Tribunal for Consumer Claims and the courts where the law gives it.' },
      ],
    },
    {
      id: 'governing-law',
      title: '33. Governing law and jurisdiction',
      blocks: [{ p: 'These terms are governed by the laws of Malaysia. Subject to any mandatory rule of law, the courts of Malaysia have jurisdiction. [Confirm with counsel.]' }],
    },
    {
      id: 'amendments',
      title: '34. Changes to these terms',
      blocks: [{ p: 'We may change these terms. We will post the new version with its date and tell signed-in users of material changes. Where the change needs it, you will be asked to accept again before continuing. If you do not accept, you may close your account.' }],
    },
    {
      id: 'contact',
      title: '35. Contact',
      blocks: [{ p: 'Operator: {company} (SSM {ssm}), {address}. Support: {supportEmail}. Privacy: {privacyEmail}.' }],
    },
  ],
};
