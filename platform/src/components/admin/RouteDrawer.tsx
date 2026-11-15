'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Drawer } from '@/components/ui/Overlay';
import { useRouter } from '@/i18n/navigation';

/** A drawer that is open because the address says so (?claim=...). Closing it (Esc, scrim, the button) goes back to `closeHref`. */
export default function RouteDrawer({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const tw = useTranslations('ws');
  return (
    <Drawer open onClose={() => router.push(closeHref)} title={title} closeLabel={tw('close')} wide>
      {children}
    </Drawer>
  );
}
