import type { ReactNode } from 'react';
import { ACTION_PATHS, AREA_PATHS } from '@/i18n/client-namespaces';
import { MESSAGES, type Locale } from '@/i18n/messages';
import { pickMessages } from '@/i18n/pick-messages';
import MessagesExtension from './MessagesExtension';

/**
 * Adds the message paths that the client components of one route area use to the small base set sent by the locale layout.
 * (Sending the whole catalogue to every page made each response ~200 KB and used the Free-plan CPU budget.)
 * Server components are unaffected: they read the full catalogue on the server.
 */
export default function ScopedMessages({ area, locale, children }: { area: string; locale: string; children: ReactNode }) {
  const listed = AREA_PATHS[area] ?? [];
  if (!listed.length) return <>{children}</>;
  const paths = listed.flatMap((p) => (p === '@actions' ? ACTION_PATHS : [p]));
  const messages = pickMessages(MESSAGES[locale as Locale] ?? MESSAGES.en, paths);
  return <MessagesExtension messages={messages}>{children}</MessagesExtension>;
}
