import { describe, expect, it } from 'vitest';
import { safeLinkHref, whatsappHref } from '@/lib/links';

describe('safeLinkHref (render-time guard for public links)', () => {
  it('accepts https links on the expected hosts', () => {
    expect(safeLinkHref('facebook', 'https://facebook.com/kedai')).toBe('https://facebook.com/kedai');
    expect(safeLinkHref('instagram', 'https://www.instagram.com/kedai/')).toBe('https://www.instagram.com/kedai/');
    expect(safeLinkHref('tiktok', 'https://www.tiktok.com/@kedai')).toBe('https://www.tiktok.com/@kedai');
    expect(safeLinkHref('youtube', 'https://youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(safeLinkHref('linkedin', 'https://my.linkedin.com/company/x')).toBe('https://my.linkedin.com/company/x');
    expect(safeLinkHref('google_maps', 'https://maps.app.goo.gl/xyz')).toBe('https://maps.app.goo.gl/xyz');
    expect(safeLinkHref('google_maps', 'https://www.google.com/maps/place/Kedai')).toBe('https://www.google.com/maps/place/Kedai');
    expect(safeLinkHref('website', 'https://kedai.com.my/about')).toBe('https://kedai.com.my/about');
  });

  it.each([
    ['website', 'javascript:alert(1)'],
    ['website', 'data:text/html,x'],
    ['website', 'http://kedai.com.my'],
    ['website', 'https://user:pw@kedai.com.my'],
    ['website', 'https://kedai.com.my:8443/'],
    ['website', 'https://localhost/x'],
    ['website', 'https://10.0.0.1/x'],
    ['website', 'https://intranet.internal/x'],
    ['facebook', 'https://evil.com/facebook.com'],
    ['facebook', 'https://notfacebook.com/x'],
    ['instagram', 'https://instagram.com.evil.com/x'],
    ['google_maps', 'https://www.google.com/search?q=x'],
    ['website', ''],
    ['website', 42],
    ['website', null],
    ['website', `https://a.com/${'x'.repeat(300)}`],
  ] as const)('refuses %s: %s', (kind, value) => {
    expect(safeLinkHref(kind, value)).toBeNull();
  });
});

describe('whatsappHref', () => {
  it('builds a wa.me link only for a stored +digits number', () => {
    expect(whatsappHref('+60123456789')).toBe('https://wa.me/60123456789');
    expect(whatsappHref('0123456789')).toBeNull();
    expect(whatsappHref('+60 12 345 6789')).toBeNull();
    expect(whatsappHref('+1234567')).toBeNull();
    expect(whatsappHref('+60123456789?text=x')).toBeNull();
    expect(whatsappHref(undefined)).toBeNull();
  });
});
