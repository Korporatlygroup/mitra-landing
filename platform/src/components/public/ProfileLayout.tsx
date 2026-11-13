'use client';

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface ProfileTab {
  key: string;
  label: string;
  panel: ReactNode;
}

/** Header card (server-rendered, passed in), tab bar, and the active panel next to the aside. Arrow keys move between tabs. */
export default function ProfileLayout({ head, tabs, aside, tabsLabel }: { head: ReactNode; tabs: ProfileTab[]; aside: ReactNode; tabsLabel: string }) {
  const [active, setActive] = useState(tabs[0]!.key);
  const base = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === active);
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    else return;
    e.preventDefault();
    setActive(tabs[n]!.key);
    document.getElementById(`${base}-tab-${tabs[n]!.key}`)?.focus();
  };
  return (
    <>
      <div className="card profile-head">
        {head}
        <div className="tabs profile-tabs" role="tablist" aria-label={tabsLabel} onKeyDown={onKey}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${base}-tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls={`${base}-panel-${t.key}`}
              tabIndex={active === t.key ? 0 : -1}
              className="tab"
              onClick={() => setActive(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="profile-cols">
        <div className="profile-main">
          {tabs.map((t) => (
            <div key={t.key} role="tabpanel" id={`${base}-panel-${t.key}`} aria-labelledby={`${base}-tab-${t.key}`} hidden={active !== t.key}>
              {t.panel}
            </div>
          ))}
        </div>
        <aside className="profile-aside">{aside}</aside>
      </div>
    </>
  );
}
