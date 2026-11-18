import { Link } from '@/i18n/navigation';

export default function SectionHeader({ id, title, more }: { id: string; title: string; more?: { href: string; label: string } }) {
  return (
    <div className="sechead">
      <h2 id={id}>{title}</h2>
      {more ? <Link href={more.href}>{more.label}</Link> : null}
    </div>
  );
}
