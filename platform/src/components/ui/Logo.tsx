import { Link } from '@/i18n/navigation';

/** 36px rounded square with "IN" in gold, next to the INOK word. `inverted` is the admin version. */
export default function Logo({ locale, inverted, small, href = '/' }: { locale: string; inverted?: boolean; small?: boolean; href?: string; label?: string }) {
  return (
    <Link href={href} locale={locale} className={`logo${inverted ? ' logo-inv' : ''}${small ? ' logo-sm' : ''}`}>
      <span className="logo-mark" aria-hidden="true">
        IN
      </span>
      <span className="logo-word">INOK</span>
    </Link>
  );
}
