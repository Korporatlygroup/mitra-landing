import type { LegalDocument } from '@/lib/legal';

export const complaints: LegalDocument = {
  title: 'Aduan dan Piawaian Komuniti',
  intro:
    'Cara melaporkan masalah di INOK, apa yang kami lakukan dengan laporan, dan apa yang kami jangka daripada semua pengguna platform. Ini ialah draf untuk semakan pengurusan dan belum berkuat kuasa.',
  sections: [
    {
      id: 'report',
      title: '1. Apa yang boleh dilaporkan',
      blocks: [
        {
          ul: [
            'penipuan atau pembekal atau pembeli yang mencurigakan;',
            'penyenaraian perniagaan yang palsu atau mengelirukan, atau produk yang diperihalkan secara mengelirukan;',
            'komunikasi kasar atau mengancam;',
            'kandungan haram atau barangan terlarang;',
            'masalah privasi atau permintaan data (lihat Notis Privasi);',
            'maklumat program kerajaan yang salah atau lapuk;',
            'permintaan membetulkan penyenaraian anda sendiri;',
            'pertikaian dengan penjual atau pembeli yang anda temui di INOK.',
          ],
        },
      ],
    },
    {
      id: 'how',
      title: '2. Cara melapor',
      blocks: [
        {
          table: {
            head: ['Apa', 'Bagaimana'],
            rows: [
              ['Penyenaraian, produk, ulasan atau permintaan pembeli', 'Gunakan pilihan "Lapor" pada halaman itu (anda perlu log masuk). Pilih sebab dan tambah nota ringkas.'],
              ['Aduan privasi atau permintaan data', 'Akaun saya, "Permintaan data anda", atau e-mel ke {privacyEmail}.'],
              ['Perkara lain, termasuk penipuan dan pertikaian', 'E-mel ke {supportEmail} dengan alamat halaman, nama yang terlibat dan apa yang berlaku. Jangan hantar imej kad pengenalan atau butiran bank.'],
              ['Maklumat program kerajaan yang salah', 'E-mel ke {supportEmail} dengan nama program dan sumber rasmi yang betul.'],
            ],
          },
        },
        { note: 'Pengurusan: sahkan alamat e-mel aduan dan sasaran masa respons sebelum penerbitan. Draf ini mencadangkan pengakuan dalam 3 hari bekerja dan balasan dalam 14 hari.' },
      ],
    },
    {
      id: 'process',
      title: '3. Apa berlaku seterusnya',
      blocks: [
        { p: 'Kami merekod laporan anda, menyemaknya berbanding apa yang kami lihat di platform dan boleh meminta maklumat daripada kedua-dua pihak. Laporan tentang penyenaraian dan produk disemak oleh kakitangan INOK yang mempunyai kebenaran sewajarnya. Kami boleh menyembunyikan atau menggantung kandungan atau akaun semasa menyiasat, meminta penjual membetulkan penyenaraian, menarik balik pengesahan, atau membuang kandungan atau akaun. Kami memberitahu anda hasilnya jika boleh. Kami tidak sentiasa dapat berkongsi butiran tindakan terhadap pengguna lain.' },
      ],
    },
    {
      id: 'limits',
      title: '4. Apa yang INOK boleh dan tidak boleh lakukan',
      blocks: [
        { p: 'INOK boleh menyederhanakan apa yang muncul di platform dan bertindak ke atas akaunnya sendiri. INOK tidak menerima atau memegang pembayaran antara pembeli dan penjual, maka ia tidak boleh memaksa penjual membayar balik, menghantar atau menunaikan, dan tidak menjamin sebarang urus niaga. Bagi pertikaian pembayaran atau penghantaran, hubungi pihak lain secara bertulis dahulu dan simpan rekod. Anda juga boleh menghubungi Kementerian Perdagangan Dalam Negeri dan Kos Sara Hidup (KPDN) atau Tribunal Tuntutan Pengguna jika undang-undang memberi hak itu, bank anda, atau polis bagi penipuan yang disyaki.' },
      ],
    },
    {
      id: 'standards',
      title: '5. Piawaian komuniti',
      blocks: [
        {
          ul: [
            'Jujur tentang siapa anda dan apa yang anda tawarkan.',
            'Berhormat. Penderaan, ancaman dan kebencian tidak dibenarkan.',
            'Jangan menyiarkan barangan haram, palsu atau tidak selamat, atau ulasan palsu.',
            'Jangan mengumpul atau menyalahgunakan butiran hubungan orang lain.',
            'Berurusan dengan adil: jangan menekan pembeli membayar di luar terma dipersetujui atau berkongsi kod keselamatan.',
          ],
        },
      ],
    },
    {
      id: 'suspension',
      title: '6. Penggantungan dan rayuan',
      blocks: [
        { p: 'Jika munasabah kami memberitahu sebab akaun atau penyenaraian digantung dan cara memberi maklum balas. Anda boleh membalas ke {supportEmail} dengan bukti dan kami akan menyemak semula keputusan itu.' },
      ],
    },
    {
      id: 'authorities',
      title: '7. Eskalasi kepada pihak berkuasa',
      blocks: [
        { p: 'Kami boleh melaporkan perkara serius (penipuan, ancaman, barangan haram, insiden keselamatan) kepada polis atau pihak berkuasa lain, dan boleh membalas permintaan sah mereka. Pelanggaran data peribadi dilaporkan kepada Pesuruhjaya Perlindungan Data Peribadi seperti dikehendaki undang-undang.' },
      ],
    },
  ],
};
