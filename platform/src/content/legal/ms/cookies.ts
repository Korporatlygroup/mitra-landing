import type { LegalDocument } from '@/lib/legal';

export const cookies: LegalDocument = {
  title: 'Dasar Kuki',
  intro:
    'INOK hanya menggunakan kuki dan storan pelayar yang diperlukan untuk log masuk anda, memastikan anda selamat dan mengingati pilihan anda. Ia tidak menggunakan kuki pengiklanan, analitik atau penjejakan. Ini ialah draf untuk semakan pengurusan dan belum berkuat kuasa.',
  sections: [
    {
      id: 'what',
      title: '1. Apa yang kami gunakan',
      blocks: [
        { p: 'Senarai ini dibuat dengan menyemak kod aplikasi dan respons laman pementasan yang sebenar. Jika teknologi baharu ditambah, dasar ini akan berubah dahulu.' },
        {
          table: {
            head: ['Nama', 'Tujuan', 'Jenis', 'Tempoh', 'Penyedia'],
            rows: [
              ['sb-…-auth-token (sesi Supabase)', 'Mengekalkan log masuk anda; HttpOnly, Secure, SameSite=Lax', 'Penting (pengesahan, sesi)', 'Sehingga 400 hari (lalai pustaka pengesahan), atau sehingga anda log keluar. Pengurusan boleh memilih tempoh lebih pendek', 'INOK (pihak pertama), dikeluarkan bersama perkhidmatan pengesahan Supabase'],
              ['inok_org', 'Mengingati organisasi yang terakhir anda buka; HttpOnly, SameSite=Lax', 'Penting (fungsi)', '90 hari', 'INOK'],
              ['NEXT_LOCALE', 'Mengingati bahasa pilihan anda (Inggeris, Bahasa Melayu atau Tamil)', 'Fungsian (pilihan bahasa)', 'Sesi pelayar', 'INOK'],
              ['Storan pelayar: inok.ws.collapsed, inok.board.view, mitra.catalogue.compare.v1', 'Mengingati sama ada menu sisi dilipat, paparan petunjuk yang anda pilih dan senarai perbandingan produk. Disimpan pada peranti anda sahaja; tiada data peribadi', 'Fungsian', 'Sehingga anda memadamnya (senarai perbandingan: sehingga tab ditutup)', 'INOK'],
            ],
          },
        },
      ],
    },
    {
      id: 'security',
      title: '2. Langkah keselamatan',
      blocks: [{ p: 'Permintaan yang mengubah data disemak terhadap pemalsuan (CSRF) menggunakan pengepala permintaan, bukan kuki tambahan. Kami menetapkan dasar keselamatan kandungan pada setiap halaman.' }],
    },
    {
      id: 'analytics',
      title: '3. Analitik dan pihak ketiga',
      blocks: [
        { p: 'Tiada alat analitik, rangkaian iklan, pemalam media sosial atau skrip pihak ketiga lain pada halaman INOK. Penyedia pengehosan kami, Cloudflare, menyampaikan halaman dan boleh memproses data permintaan teknikal, seperti alamat IP, untuk berbuat demikian. Jika analitik ditambah kelak, kami akan meminta pilihan anda sebelum ia berjalan.' },
      ],
    },
    {
      id: 'choices',
      title: '4. Pilihan anda',
      blocks: [
        { p: 'Item penting dan fungsian tidak boleh dimatikan dalam INOK kerana perkhidmatan tidak akan berfungsi: tanpa kuki sesi anda tidak boleh kekal log masuk. Anda boleh memadam atau menyekat kuki dalam tetapan pelayar; INOK kemudian akan menunjukkan bahasa alamat halaman dan meminta anda log masuk semula. Oleh kerana kami tidak menggunakan kuki penjejakan pilihan, kami tidak menunjukkan sepanduk persetujuan. Kami akan menambah kawalan pilihan yang berfungsi sebaik sahaja sebarang teknologi pilihan diperkenalkan.' },
      ],
    },
    {
      id: 'contact',
      title: '5. Soalan',
      blocks: [{ p: 'Tulis ke {privacyEmail}. Pengendali: {company}, SSM {ssm}. Dikemas kini {updated}.' }],
    },
  ],
};
