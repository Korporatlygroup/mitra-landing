import Icon, { type IconName } from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';

/** A section with nothing to show yet: an icon, what it is, one sentence and one useful action. It never contains invented content. */
export default function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: { href: string; label: string } }) {
  return (
    <div className="empty-x" role="status">
      <span className="empty-x-ico" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action ? (
        <Link href={action.href} className="btn btn-secondary btn-sm">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
