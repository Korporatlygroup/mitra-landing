import type { ReactNode } from 'react';
import ScopedMessages from '@/components/ScopedMessages';

/** Sign-in style pages: one centred card, wide pill buttons, large inputs. */
export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ScopedMessages area="reset-password" locale={locale}>
      <div className="auth-shell">
        <div className="auth-card">{children}</div>
      </div>
    </ScopedMessages>
  );
}
