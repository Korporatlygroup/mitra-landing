import type { LegalDocument } from '@/lib/legal';

export const marketplacePolicy: LegalDocument = {
  title: 'Dasar Pembeli, Penjual dan Pembekal',
  intro:
    'Dasar ini menyatakan apa yang INOK jangka daripada penjual, pembeli dan pembekal antarabangsa, dan apa yang INOK lakukan sebagai pengendali platform. Ia sebahagian daripada Terma Perkhidmatan. Ini ialah draf untuk semakan pengurusan dan peguam dan belum berkuat kuasa.',
  sections: [
    {
      id: 'about',
      title: '1. Perkara yang diliputi dasar ini',
      blocks: [
        { p: 'INOK terutamanya platform penemuan perniagaan, komunikasi dan sumber. Kontrak untuk barangan atau perkhidmatan dibuat antara pembeli dan penjual atau pembekal. INOK tidak memproses pembayaran, memegang dana, menyediakan eskrow atau menjamin sebarang urus niaga. Dikendalikan oleh {company}, SSM {ssm}.' },
      ],
    },
    {
      id: 'sellers',
      title: '2. Kewajipan penjual',
      blocks: [
        {
          ul: [
            'beri maklumat perniagaan yang tepat, termasuk nama perniagaan berdaftar dan, jika berdaftar, nombor SSM anda;',
            'simpan butiran hubungan yang sah supaya pembeli dan INOK boleh menghubungi anda;',
            'tawarkan barangan dan perkhidmatan tulen yang anda berhak menjualnya;',
            'nyatakan harga atau terma sebut harga dengan tepat dan tunjukkan harga penuh termasuk penghantaran, cukai dan caj lain apabila anda memberi sebut harga;',
            'pegang dan, apabila diminta, tunjukkan lesen, permit dan pensijilan yang diperlukan;',
            'jangan menawarkan barangan terlarang, membuat dakwaan mengelirukan atau mendakwa sokongan yang tidak anda ada;',
            'balas pertanyaan dalam masa yang munasabah;',
            'buat komitmen penghantaran dan penunaian yang anda boleh tunaikan dengan jujur, dan maklumkan pembeli segera jika ada perubahan.',
          ],
        },
        { p: 'Jika Peraturan-Peraturan Perlindungan Pengguna (Urus Niaga Perdagangan Elektronik) 2024 terpakai kepada perdagangan anda melalui platform, anda juga mesti menzahirkan maklumat yang dikehendaki Peraturan-Peraturan itu dalam bahasa kebangsaan (lihat bahagian 6) dan tidak boleh memberi maklumat yang anda tahu atau ada sebab percaya palsu atau mengelirukan.' },
      ],
    },
    {
      id: 'buyers',
      title: '3. Kewajipan pembeli',
      blocks: [
        {
          ul: [
            'hantar pertanyaan yang tepat dan permintaan yang tulen;',
            'berkomunikasi dengan hormat;',
            'jangan membuat permintaan yang menipu, kasar atau membuang masa, dan jangan menggunakan butiran hubungan platform untuk pemasaran yang tidak berkaitan;',
            'gunakan sebut harga dan alat sumber dengan betul: terima sebut harga hanya apabila anda berniat meneruskan, dan maklumkan penjual jika keperluan anda berubah;',
            'bayar apa yang dipersetujui melalui aturan yang dipersetujui dengan penjual.',
          ],
        },
      ],
    },
    {
      id: 'suppliers',
      title: '4. Kewajipan pembekal antarabangsa dan rakan kongsi',
      blocks: [
        {
          ul: [
            'maklumat syarikat dan produk yang tepat;',
            'terma sebut harga yang jelas: harga, mata wang, kesahan, kuantiti pesanan minimum dan masa pendahuluan;',
            'pernyataan jelas kaedah penghantaran, tanggungjawab penghantaran dan pemindahan risiko;',
            'dokumen import dan eksport jika berkaitan, dan pematuhan keperluan kastam dan peraturan negara terlibat;',
            'pematuhan piawaian produk, pelabelan dan peraturan keselamatan yang terpakai kepada barangan di negara destinasi;',
            'aturan pembayaran yang jelas, kaedah pembayaran diterima dan sebarang caj bank atau pemindahan;',
            'penzahiran setiap caj berkaitan, seperti tambang, insurans, duti, cukai dan kos sampel, sebelum pembeli membuat komitmen.',
          ],
        },
      ],
    },
    {
      id: 'operator',
      title: '5. Apa yang INOK lakukan sebagai pengendali',
      blocks: [
        {
          ul: [
            'menyediakan cara untuk melaporkan penyenaraian, produk, ulasan dan permintaan, dan saluran untuk aduan (lihat halaman Aduan dan Piawaian Komuniti);',
            'menyemak penyenaraian perniagaan, produk dan rekod pembekal sebelum diterbitkan dan menyemak maklumat penjual yang dikumpul platform;',
            'menyederhanakan laporan dan ulasan dan boleh menyembunyikan, menggantung atau membuang kandungan atau akaun yang melanggar peraturan ini;',
            'menyimpan rekod pembekal pasar seperti dikehendaki undang-undang, selama tiga tahun (lihat bahagian 6);',
            'menyiasat laporan setakat yang boleh dilihat, dan boleh merujuk perkara kepada polis atau pihak berkuasa lain;',
            'tidak memegang wang pembeli, tidak menjamin sebarang urus niaga dan tidak boleh memaksa penjual membayar balik, menghantar atau menunaikan.',
          ],
        },
      ],
    },
    {
      id: 'law',
      title: '6. Peraturan-Peraturan Urus Niaga Perdagangan Elektronik 2024',
      blocks: [
        { p: 'Peraturan-Peraturan Perlindungan Pengguna (Urus Niaga Perdagangan Elektronik) 2024 (P.U.(A) 449, berkuat kuasa 25 Disember 2024) mewajibkan pembekal pasar dalam talian menzahirkan, dalam bahasa kebangsaan, maklumat berikut di pasar:' },
        {
          ul: [
            'nama pembekal atau syarikat;',
            'alamat laman sesawang pasar, jika ada;',
            'alamat e-mel dan nombor telefon;',
            'alamat tempat perdagangan atau pengiklanan dijalankan;',
            'perihalan ciri utama barangan atau perkhidmatan;',
            'harga penuh termasuk penghantaran, cukai dan kos lain;',
            'kaedah pembayaran;',
            'terma dan syarat jualan dan pembelian;',
            'anggaran masa penghantaran;',
            'perakuan bahawa barangan atau perkhidmatan memenuhi piawaian keselamatan dan kesihatan yang ditetapkan agensi berwibawa, jika ada.',
          ],
        },
        { p: 'Ia juga mewajibkan pengendali pasar dalam talian memastikan pembekal mematuhi kewajipan penzahiran itu sebelum urus niaga perdagangan elektronik dibenarkan, menyediakan saluran aduan untuk pembeli, memastikan pengiklanan tidak melanggar Peraturan-Peraturan, dan menyimpan rekod pembekal (butiran identiti dan hubungan, nombor akaun perniagaan, pendaftaran perdagangan atau syarikat, dan rekod urus niaga atau pengiklanan) selama tiga tahun.' },
        { note: 'Pengurusan dan peguam: sama ada dan bagaimana Peraturan-Peraturan ini terpakai kepada direktori dan alat sumber INOK (yang antara perniagaan, tidak menerima bayaran dan tidak melengkapkan pesanan) ialah soalan undang-undang. Draf ini menganggap senarai penzahiran sebagai piawaian yang patut dipenuhi penjual. Audit medan penjual INOK semasa berbanding senarai ini terdapat dalam dokumen pematuhan dan menunjukkan jurang yang sedang ditutup.' },
      ],
    },
    {
      id: 'enforcement',
      title: '7. Penguatkuasaan',
      blocks: [
        { p: 'Kami boleh memberi amaran, meminta pembetulan, menyembunyikan kandungan, menggantung atau menutup akaun, menarik balik pengesahan dan berkongsi maklumat dengan pihak berkuasa. Pelanggaran berulang atau serius (penipuan, barangan palsu, barangan haram, identiti palsu) boleh menyebabkan penggantungan serta-merta.' },
      ],
    },
  ],
};
