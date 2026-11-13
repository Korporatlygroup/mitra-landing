'use client';

import { Link, usePathname } from '@/i18n/navigation';
import Icon, { type IconName } from '@/components/ui/Icon';

export interface AdminItem {
  key: string;
  href: string;
  label: string;
  icon: IconName;
  match: string[];
  exact?: boolean;
  count?: number;
}
export interface AdminGroup {
  key: string;
  label: string | null;
  items: AdminItem[];
}

/** Dark side menu of the admin console. The current page is a gold fill with ink text (aria-current="page"). */
export default function AdminNav({ groups, label }: { groups: AdminGroup[]; label: string }) {
  const path = usePathname();
  const on = (i: AdminItem) => (i.exact ? path === i.href : i.match.some((m) => path === m || path.startsWith(`${m}/`)));
  return (
    <nav aria-label={label} style={{ display: 'contents' }}>
      {groups.map((g) => (
        <div key={g.key} style={{ display: 'contents' }}>
          {g.label ? <p className="ag">{g.label}</p> : null}
          {g.items.map((i) => (
            <Link key={i.key} href={i.href} className="al" aria-current={on(i) ? 'page' : undefined}>
              <Icon name={i.icon} size={20} />
              <span>{i.label}</span>
              {i.count ? <span className="ad-cnt">{i.count}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
