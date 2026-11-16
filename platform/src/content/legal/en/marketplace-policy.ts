import type { LegalDocument } from '@/lib/legal';

export const marketplacePolicy: LegalDocument = {
  title: 'Buyer, Seller and Supplier Policy',
  intro:
    'This policy sets out what INOK expects of sellers, buyers and international suppliers, and what INOK does as the operator of the platform. It forms part of the Terms of Service. This is a draft for management and legal review and is not yet in force.',
  sections: [
    {
      id: 'about',
      title: '1. What this policy covers',
      blocks: [
        { p: 'INOK is primarily a business-discovery, communication and sourcing platform. Contracts for goods or services are made between the buyer and the seller or supplier. INOK does not process payments, hold funds, provide escrow or guarantee any transaction. Operated by {company}, SSM {ssm}.' },
      ],
    },
    {
      id: 'sellers',
      title: '2. Seller obligations',
      blocks: [
        {
          ul: [
            'give accurate business information, including your registered business name and, where you are registered, your SSM number;',
            'keep valid contact details so buyers and INOK can reach you;',
            'offer genuine goods and services that you are entitled to sell;',
            'state prices or quotation terms accurately and show the full price including delivery, tax and other charges when you quote;',
            'hold and, where asked, show the licences, permits and certifications your goods or services need;',
            'never offer prohibited goods, make misleading claims or claim endorsements you do not have;',
            'reply to enquiries in a reasonable time;',
            'make delivery and fulfilment commitments you can honestly keep, and tell the buyer promptly if something changes.',
          ],
        },
        { p: 'Where the Consumer Protection (Electronic Trade Transaction) Regulations 2024 apply to your trade through the platform, you must also disclose the information the Regulations require in the national language (see section 6) and must not give information you know or have reason to believe is false or misleading.' },
      ],
    },
    {
      id: 'buyers',
      title: '3. Buyer obligations',
      blocks: [
        {
          ul: [
            'send accurate enquiries and genuine requests;',
            'communicate respectfully;',
            'do not make fraudulent, abusive or time-wasting requests, and do not use platform contact details for unrelated marketing;',
            'use quotations and sourcing tools properly: accept a quotation only when you intend to proceed, and tell the seller if your needs change;',
            'pay what you agreed through the arrangement you agreed with the seller.',
          ],
        },
      ],
    },
    {
      id: 'suppliers',
      title: '4. International supplier and partner obligations',
      blocks: [
        {
          ul: [
            'accurate company and product information;',
            'clear quotation terms: price, currency, validity, minimum order quantity and lead time;',
            'clear statement of shipping method, delivery responsibility and risk transfer;',
            'import and export documentation where applicable, and compliance with customs and regulatory requirements of the countries involved;',
            'compliance with product standards, labelling and safety rules that apply to the goods in the destination country;',
            'clear payment arrangements, accepted payment methods and any bank or transfer charges;',
            'disclosure of every relevant charge, such as freight, insurance, duties, taxes and sample costs, before the buyer commits.',
          ],
        },
      ],
    },
    {
      id: 'operator',
      title: '5. What INOK does as the operator',
      blocks: [
        {
          ul: [
            'provides a way to report listings, products, reviews and requests, and a channel for complaints (see the Complaints and Community Standards page);',
            'reviews business listings, products and supplier records before they are published and checks the seller information the platform collects;',
            'moderates reports and reviews and may hide, suspend or remove content or accounts that break these rules;',
            'keeps records of marketplace suppliers as the law requires, for three years (see section 6);',
            'investigates reports in proportion to what it can see, and may refer matters to the police or other authorities;',
            'does not hold buyer money, does not guarantee any transaction and cannot force a seller to refund, deliver or perform.',
          ],
        },
      ],
    },
    {
      id: 'law',
      title: '6. The Electronic Trade Transaction Regulations 2024',
      blocks: [
        { p: 'The Consumer Protection (Electronic Trade Transaction) Regulations 2024 (P.U.(A) 449, in force 25 December 2024) require an online marketplace supplier to disclose, in the national language, the following information on the marketplace:' },
        {
          ul: [
            'supplier or company name;',
            'the marketplace website address, if any;',
            'email address and telephone number;',
            'the address of the place where the trade or advertisement is conducted;',
            'a description of the main features of the goods or services;',
            'the full price including delivery, tax and any other cost;',
            'payment methods;',
            'terms and conditions of sale and purchase;',
            'estimated delivery time;',
            'a declaration that the goods or services meet any health and safety standard set by a competent authority, if there is one.',
          ],
        },
        { p: 'They also require an online marketplace operator to ensure that suppliers comply with that disclosure duty before an electronic trade transaction is allowed, to provide a channel for purchasers to lodge complaints, to ensure advertisements do not breach the Regulations, and to keep supplier records (identity and contact details, business account number, trade or company registration, and transaction or advertisement records) for three years.' },
        { note: 'Management and counsel: whether and how these Regulations apply to INOK\'s directory and sourcing tools (which are business-to-business, take no payment and do not complete orders) is a legal question. This draft treats the disclosure list as the standard sellers should meet. The audit of INOK\'s current seller fields against this list is in the compliance documents and shows gaps that are being closed.' },
      ],
    },
    {
      id: 'enforcement',
      title: '7. Enforcement',
      blocks: [
        { p: 'We may warn, ask for corrections, hide content, suspend or close accounts, withdraw verification and share information with authorities. Repeated or serious breaches (fraud, counterfeit goods, illegal goods, false identity) may lead to immediate suspension.' },
      ],
    },
  ],
};
