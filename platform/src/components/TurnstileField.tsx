import { turnstileSiteKey } from '@/lib/turnstile';
import TurnstileWidget from './TurnstileWidget';

/** Renders the security check only when a site key is configured at build time; otherwise nothing at all. */
export default function TurnstileField({ language }: { language?: string }) {
  const key = turnstileSiteKey();
  return key ? <TurnstileWidget siteKey={key} language={language} /> : null;
}
