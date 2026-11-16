import { createNavigation } from 'next-intl/navigation';
import type { ComponentProps } from 'react';
import { routing } from './routing';

const nav = createNavigation(routing);

export const { usePathname, useRouter } = nav;

/**
 * Locale-aware link. Prefetching is OFF unless a caller turns it on: with it on, every page view asks the server to render the target
 * of each visible link (the footer alone has six), and on the Cloudflare Free plan those background renders use CPU that the page the
 * visitor asked for needs (Worker CPU limit: 10 ms per request).
 */
export function Link(props: ComponentProps<typeof nav.Link>) {
  return <nav.Link {...props} prefetch={props.prefetch ?? false} />;
}
