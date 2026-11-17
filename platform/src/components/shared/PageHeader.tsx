import type { ReactNode } from 'react';

/** One page header for every workspace page: title, one sentence, and the primary actions on the right (stacked on phones). */
export default function PageHeader({ title, sub, actions, eyebrow }: { title: string; sub?: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="pagehead pagehead-x">
      <div className="pagehead-text">
        {eyebrow ? <div className="pagehead-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="pagehead-actions">{actions}</div> : null}
    </header>
  );
}
