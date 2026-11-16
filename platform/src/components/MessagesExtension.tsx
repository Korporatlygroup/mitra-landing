'use client';

import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl';
import type { ReactNode } from 'react';
import { mergeMessages } from '@/i18n/pick-messages';

/** Nested provider: the parent's messages plus the extra ones for this route area (a nested provider would otherwise replace them). */
export default function MessagesExtension({ messages, children }: { messages: Record<string, unknown>; children: ReactNode }) {
  const parent = useMessages() as Record<string, unknown>;
  const locale = useLocale();
  return (
    <NextIntlClientProvider locale={locale} messages={mergeMessages(parent, messages) as never}>
      {children}
    </NextIntlClientProvider>
  );
}
