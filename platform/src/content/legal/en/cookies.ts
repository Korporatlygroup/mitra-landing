import type { LegalDocument } from '@/lib/legal';

export const cookies: LegalDocument = {
  title: 'Cookie Policy',
  intro:
    'INOK uses only the cookies and browser storage it needs to sign you in, keep you safe and remember your choices. It does not use advertising, analytics or tracking cookies. This is a draft for management review and is not yet in force.',
  sections: [
    {
      id: 'what',
      title: '1. What we use',
      blocks: [
        { p: 'This list was made by checking the application code and the responses of the live staging site. If a new technology is added, this policy will change first.' },
        {
          table: {
            head: ['Name', 'Purpose', 'Type', 'Duration', 'Provider'],
            rows: [
              ['sb-…-auth-token (Supabase session)', 'Keeps you signed in; HttpOnly, Secure, SameSite=Lax', 'Essential (authentication, session)', 'Up to 400 days (the authentication library default), or until you sign out. Management may choose a shorter period', 'INOK (first party), issued with the Supabase authentication service'],
              ['inok_org', 'Remembers which of your organisations you last opened; HttpOnly, SameSite=Lax', 'Essential (function)', '90 days', 'INOK'],
              ['NEXT_LOCALE', 'Remembers the language you chose (English, Bahasa Melayu or Tamil)', 'Functional (language preference)', 'Browser session', 'INOK'],
              ['Browser storage: inok.ws.collapsed, inok.board.view, mitra.catalogue.compare.v1', 'Remember whether the side menu is collapsed, the leads view you chose and your product comparison list. Stored on your device only; no personal data', 'Functional', 'Until you clear it (compare list: until the tab closes)', 'INOK'],
            ],
          },
        },
      ],
    },
    {
      id: 'security',
      title: '2. Security measures',
      blocks: [{ p: 'Requests that change data are checked against forgery (CSRF) using request headers, not an additional cookie. We set a content security policy on every page.' }],
    },
    {
      id: 'analytics',
      title: '3. Analytics and third parties',
      blocks: [
        { p: 'There are no analytics tools, advertising networks, social-media plug-ins or other third-party scripts on INOK pages. Our hosting provider, Cloudflare, delivers the pages and may process technical request data, such as the IP address, to do so. If analytics are added later we will ask for your choice before they run.' },
      ],
    },
    {
      id: 'choices',
      title: '4. Your choices',
      blocks: [
        { p: 'Essential and functional items cannot be switched off inside INOK because the service would not work: without the session cookie you cannot stay signed in. You can delete or block cookies in your browser settings; INOK will then show the language of the page address and ask you to sign in again. Because we use no optional tracking cookies, we do not show a consent banner. We will add a working preference control as soon as any optional technology is introduced.' },
      ],
    },
    {
      id: 'contact',
      title: '5. Questions',
      blocks: [{ p: 'Write to {privacyEmail}. Operator: {company}, SSM {ssm}. Last updated {updated}.' }],
    },
  ],
};
