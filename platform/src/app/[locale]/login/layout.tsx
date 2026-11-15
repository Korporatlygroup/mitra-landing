import type { ReactNode } from 'react';

/** Sign-in style pages: one centred card, wide pill buttons, large inputs. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">{children}</div>
    </div>
  );
}
