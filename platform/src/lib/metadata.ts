import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

/** Translated page title (the layout template appends the app name). `key` is "namespace.key". */
export async function pageTitle(locale: string, key: string): Promise<Metadata> {
  const [namespace, ...rest] = key.split('.');
  const t = await getTranslations({ locale, namespace });
  return { title: t(rest.join('.')) };
}
