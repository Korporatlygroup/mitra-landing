// Generates the INOK account email templates for Supabase Auth (supabase/templates/*.html).
// Run: node scripts/build-email-templates.mjs   (the output is committed; edit the text here, not the HTML).
// Supabase Auth templates are one HTML body per message type (no separate plain-text part) and one subject per type, so the
// subjects are English and the body switches language with the `language` value stored in the user's metadata at sign-up.
// The Malay and Tamil text is a draft that still needs review by a native speaker before launch.
import { mkdirSync, writeFileSync } from 'node:fs';

const BRAND = '#8c1d40';
const T = {
  confirmation: {
    subject: 'Confirm your INOK account',
    link: '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/',
    en: { h: 'Confirm your INOK account', p: ['Thank you for registering with INOK. Please confirm your email address to finish creating your account.'], b: 'Confirm email address', n: 'If you did not create an INOK account, you can ignore this email.' },
    ms: { h: 'Sahkan akaun INOK anda', p: ['Terima kasih kerana mendaftar dengan INOK. Sila sahkan alamat e-mel anda untuk melengkapkan akaun anda.'], b: 'Sahkan alamat e-mel', n: 'Jika anda tidak mendaftar akaun INOK, sila abaikan e-mel ini.' },
    ta: { h: 'உங்கள் INOK கணக்கை உறுதிப்படுத்துங்கள்', p: ['INOK-இல் பதிவு செய்ததற்கு நன்றி. உங்கள் கணக்கை முடிக்க மின்னஞ்சல் முகவரியை உறுதிப்படுத்துங்கள்.'], b: 'மின்னஞ்சலை உறுதிப்படுத்து', n: 'நீங்கள் INOK கணக்கை உருவாக்கவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும்.' },
  },
  recovery: {
    subject: 'Reset your INOK password',
    link: '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password',
    en: { h: 'Reset your INOK password', p: ['We received a request to reset the password for your INOK account. The link works once and expires soon.'], b: 'Choose a new password', n: 'If you did not ask for this, you can ignore this email. Your password stays the same.' },
    ms: { h: 'Tetapkan semula kata laluan INOK anda', p: ['Kami menerima permintaan untuk menetapkan semula kata laluan akaun INOK anda. Pautan ini hanya boleh digunakan sekali dan akan tamat tempoh tidak lama lagi.'], b: 'Pilih kata laluan baharu', n: 'Jika anda tidak membuat permintaan ini, sila abaikan e-mel ini. Kata laluan anda tidak berubah.' },
    ta: { h: 'உங்கள் INOK கடவுச்சொல்லை மீட்டமைக்கவும்', p: ['உங்கள் INOK கணக்கின் கடவுச்சொல்லை மீட்டமைக்க கோரிக்கை கிடைத்தது. இந்த இணைப்பு ஒருமுறை மட்டுமே செயல்படும்; விரைவில் காலாவதியாகும்.'], b: 'புதிய கடவுச்சொல்லைத் தேர்ந்தெடுக்கவும்', n: 'நீங்கள் இதைக் கோரவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும். உங்கள் கடவுச்சொல் மாறாது.' },
  },
  email_change: {
    subject: 'Confirm your new INOK email address',
    link: '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email_change&next=/account',
    en: { h: 'Confirm your new email address', p: ['You asked to change the email address of your INOK account to {{ .NewEmail }}. Please confirm the change.'], b: 'Confirm new email address', n: 'If you did not ask for this, do not click the button and reset your password.' },
    ms: { h: 'Sahkan alamat e-mel baharu anda', p: ['Anda meminta untuk menukar alamat e-mel akaun INOK anda kepada {{ .NewEmail }}. Sila sahkan perubahan ini.'], b: 'Sahkan alamat e-mel baharu', n: 'Jika anda tidak membuat permintaan ini, jangan klik butang ini dan tetapkan semula kata laluan anda.' },
    ta: { h: 'உங்கள் புதிய மின்னஞ்சல் முகவரியை உறுதிப்படுத்துங்கள்', p: ['உங்கள் INOK கணக்கின் மின்னஞ்சலை {{ .NewEmail }} ஆக மாற்றக் கோரினீர்கள். இந்த மாற்றத்தை உறுதிப்படுத்துங்கள்.'], b: 'புதிய மின்னஞ்சலை உறுதிப்படுத்து', n: 'நீங்கள் இதைக் கோரவில்லை என்றால் பொத்தானைக் கிளிக் செய்ய வேண்டாம்; கடவுச்சொல்லை மீட்டமைக்கவும்.' },
  },
  invite: {
    subject: 'You have been invited to INOK',
    link: '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/account',
    en: { h: 'You have been invited to INOK', p: ['An INOK administrator invited you to create an account.'], b: 'Accept the invitation', n: 'If you were not expecting this invitation, you can ignore this email.' },
    ms: { h: 'Anda dijemput ke INOK', p: ['Seorang pentadbir INOK menjemput anda untuk membuat akaun.'], b: 'Terima jemputan', n: 'Jika anda tidak menjangkakan jemputan ini, sila abaikan e-mel ini.' },
    ta: { h: 'நீங்கள் INOK-க்கு அழைக்கப்பட்டுள்ளீர்கள்', p: ['ஒரு INOK நிர்வாகி கணக்கை உருவாக்க உங்களை அழைத்துள்ளார்.'], b: 'அழைப்பை ஏற்கவும்', n: 'இந்த அழைப்பை நீங்கள் எதிர்பார்க்கவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும்.' },
  },
  magic_link: {
    subject: 'Your INOK sign-in link',
    link: '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink&next=/',
    en: { h: 'Your INOK sign-in link', p: ['Use the button below to sign in to INOK. The link works once.'], b: 'Sign in to INOK', n: 'If you did not ask to sign in, you can ignore this email.' },
    ms: { h: 'Pautan log masuk INOK anda', p: ['Gunakan butang di bawah untuk log masuk ke INOK. Pautan ini hanya boleh digunakan sekali.'], b: 'Log masuk ke INOK', n: 'Jika anda tidak meminta log masuk, sila abaikan e-mel ini.' },
    ta: { h: 'உங்கள் INOK உள்நுழைவு இணைப்பு', p: ['INOK-இல் உள்நுழைய கீழுள்ள பொத்தானைப் பயன்படுத்தவும். இந்த இணைப்பு ஒருமுறை மட்டுமே செயல்படும்.'], b: 'INOK-இல் உள்நுழை', n: 'நீங்கள் உள்நுழைவைக் கோரவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும்.' },
  },
  reauthentication: {
    subject: 'Your INOK confirmation code',
    code: '{{ .Token }}',
    en: { h: 'Your confirmation code', p: ['Enter this code to confirm a sensitive change to your INOK account:'], n: 'If you did not ask for this code, reset your password.' },
    ms: { h: 'Kod pengesahan anda', p: ['Masukkan kod ini untuk mengesahkan perubahan penting pada akaun INOK anda:'], n: 'Jika anda tidak meminta kod ini, tetapkan semula kata laluan anda.' },
    ta: { h: 'உங்கள் உறுதிப்படுத்தும் குறியீடு', p: ['உங்கள் INOK கணக்கில் முக்கிய மாற்றத்தை உறுதிப்படுத்த இந்தக் குறியீட்டை உள்ளிடவும்:'], n: 'நீங்கள் இந்தக் குறியீட்டைக் கோரவில்லை என்றால் கடவுச்சொல்லை மீட்டமைக்கவும்.' },
  },
  password_changed_notification: {
    subject: 'Your INOK password was changed',
    en: { h: 'Your INOK password was changed', p: ['The password for your INOK account ({{ .Email }}) was just changed.'], n: 'If this was you, no action is needed. If it was not you, reset your password straight away and contact the INOK team.' },
    ms: { h: 'Kata laluan INOK anda telah ditukar', p: ['Kata laluan akaun INOK anda ({{ .Email }}) baru sahaja ditukar.'], n: 'Jika ini anda, tiada tindakan diperlukan. Jika bukan anda, tetapkan semula kata laluan dengan segera dan hubungi pasukan INOK.' },
    ta: { h: 'உங்கள் INOK கடவுச்சொல் மாற்றப்பட்டது', p: ['உங்கள் INOK கணக்கின் ({{ .Email }}) கடவுச்சொல் இப்போதுதான் மாற்றப்பட்டது.'], n: 'இது நீங்களாக இருந்தால் எதுவும் செய்ய வேண்டாம். நீங்கள் இல்லையெனில் உடனே கடவுச்சொல்லை மீட்டமைத்து INOK குழுவைத் தொடர்புகொள்ளுங்கள்.' },
  },
  email_changed_notification: {
    subject: 'The email address on your INOK account was changed',
    en: { h: 'The email address on your INOK account was changed', p: ['The email address of your INOK account was changed from {{ .OldEmail }} to {{ .Email }}.'], n: 'If this was you, no action is needed. If it was not you, reset your password straight away and contact the INOK team.' },
    ms: { h: 'Alamat e-mel akaun INOK anda telah ditukar', p: ['Alamat e-mel akaun INOK anda telah ditukar daripada {{ .OldEmail }} kepada {{ .Email }}.'], n: 'Jika ini anda, tiada tindakan diperlukan. Jika bukan anda, tetapkan semula kata laluan dengan segera dan hubungi pasukan INOK.' },
    ta: { h: 'உங்கள் INOK கணக்கின் மின்னஞ்சல் முகவரி மாற்றப்பட்டது', p: ['உங்கள் INOK கணக்கின் மின்னஞ்சல் {{ .OldEmail }} இலிருந்து {{ .Email }} ஆக மாற்றப்பட்டது.'], n: 'இது நீங்களாக இருந்தால் எதுவும் செய்ய வேண்டாம். நீங்கள் இல்லையெனில் உடனே கடவுச்சொல்லை மீட்டமைத்து INOK குழுவைத் தொடர்புகொள்ளுங்கள்.' },
  },
};

const FOOTER = {
  en: 'INOK is an independent business platform. It is not a government agency and does not decide eligibility for any programme.',
  ms: 'INOK ialah platform perniagaan bebas. INOK bukan agensi kerajaan dan tidak menentukan kelayakan bagi sebarang program.',
  ta: 'INOK ஒரு சுதந்திரமான வணிகத் தளம். இது அரசு நிறுவனம் அல்ல; எந்த திட்டத்திற்கும் தகுதியை இது தீர்மானிக்காது.',
};

const esc = (s) => s;
function body(t, lang, link) {
  const c = t[lang];
  const paras = c.p.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#222;">${esc(p)}</p>`).join('');
  const action = link
    ? `<p style="margin:24px 0;"><a href="${link}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:8px;">${c.b}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#555;word-break:break-all;">${link}</p>`
    : t.code
      ? `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:6px;color:${BRAND};">${t.code}</p>`
      : '';
  return `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111;">${c.h}</h1>${paras}${action}<p style="margin:0;font-size:14px;line-height:1.5;color:#555;">${c.n}</p>`;
}

function page(t) {
  const link = t.link;
  const sections = `{{ if eq .Data.language "ms" }}${body(t, 'ms', link)}{{ else if eq .Data.language "ta" }}${body(t, 'ta', link)}{{ else }}${body(t, 'en', link)}{{ end }}`;
  const footer = `{{ if eq .Data.language "ms" }}${FOOTER.ms}{{ else if eq .Data.language "ta" }}${FOOTER.ta}{{ else }}${FOOTER.en}{{ end }}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${t.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f6f1f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1f3;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:2px;">INOK</td></tr>
<tr><td style="padding:28px;">${sections}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eee;font-size:12px;line-height:1.5;color:#666;">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

mkdirSync('supabase/templates', { recursive: true });
const manifest = {};
for (const [name, t] of Object.entries(T)) {
  writeFileSync(`supabase/templates/${name}.html`, page(t));
  manifest[name] = t.subject;
}
writeFileSync('supabase/templates/subjects.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${Object.keys(T).length} templates`);
