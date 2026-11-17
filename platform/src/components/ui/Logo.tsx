import { Link } from '@/i18n/navigation';

/** The INOK shop-and-arrow mark (public/brand/inok-mark.png) next to the INOK word. `inverted` is the admin version (the mark sits on a white tile). */
export default function Logo({ locale, inverted, small, href = '/' }: { locale: string; inverted?: boolean; small?: boolean; href?: string; label?: string }) {
  const h = small ? 40 : 42;
  return (
    <Link href={href} locale={locale} className={`logo${inverted ? ' logo-inv' : ''}${small ? ' logo-sm' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo-img" src="/brand/inok-mark.png" alt="" width={Math.round(h * 0.95)} height={h} decoding="async" />
      <span className="logo-word">INOK</span>
    </Link>
  );
}
