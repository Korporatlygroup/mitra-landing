import { Link } from '@/i18n/navigation';

export interface TabItem {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}

/** Link-based tabs (filters that change the URL): work without JavaScript, keep the back button and can be shared. */
export default function TabsNav({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav className="tabs-x" aria-label={label}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="tab-x" aria-current={i.active ? 'page' : undefined}>
          {i.label}
          {i.count !== undefined ? <span className="tab-x-n">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
