/**
 * Optional Cloudflare Turnstile for public registration, sign-in and password reset. OFF unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set at build time
 * (it is a public site key). When it is off nothing changes: no widget, no token, no extra script allowed by the CSP.
 * Enabling needs two coordinated production changes that are NOT made by this code: the site key in the build, and Supabase Auth "captcha" turned on
 * with the matching secret (Supabase then rejects calls without a valid token, so both sides must be switched together; see docs/turnstile-rollout.md).
 */
export const CAPTCHA_FIELD = 'captchaToken';
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export function turnstileSiteKey(): string {
  return (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();
}
export const captchaEnabled = (): boolean => turnstileSiteKey() !== '';

/** The token the widget put in the form, or undefined. Length-capped; never logged. */
export function captchaTokenFrom(fd: FormData): string | undefined {
  const v = fd.get(CAPTCHA_FIELD);
  return typeof v === 'string' && v.length > 0 && v.length <= 4096 ? v : undefined;
}
