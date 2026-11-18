import Icon, { type IconName } from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';

export default function DiscoveryCard({ href, icon, title, text, action }: { href: string; icon: IconName; title: string; text: string; action: string }) {
  return (
    <Link href={href} className="dcard">
      <span className="dcard-ico" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <span className="dcard-go">
        {action}
        <Icon name="forward" size={16} />
      </span>
    </Link>
  );
}
