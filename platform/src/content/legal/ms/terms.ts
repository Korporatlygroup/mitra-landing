import type { LegalDocument } from '@/lib/legal';

export const terms: LegalDocument = {
  title: 'Terma Perkhidmatan',
  intro:
    'Terma ini mengawal penggunaan INOK anda. INOK terutamanya platform untuk penemuan perniagaan, komunikasi dan sumber. Ia bukan kedai, perkhidmatan pembayaran atau perkhidmatan eskrow. Ini ialah draf untuk semakan pengurusan dan peguam dan belum berkuat kuasa.',
  sections: [
    {
      id: 'operator',
      title: '1. Pengendali platform',
      blocks: [
        { p: 'INOK dikendalikan oleh {company}, nombor pendaftaran SSM {ssm}, beralamat {address} ("INOK", "kami"). Hubungan: {supportEmail}. Tarikh berkuat kuasa: {effective}. Dikemas kini: {updated}.' },
      ],
    },
    {
      id: 'definitions',
      title: '2. Takrifan',
      blocks: [
        {
          ul: [
            '"Platform" bermaksud laman web dan aplikasi INOK.',
            '"Pengguna" bermaksud sesiapa yang menggunakan platform.',
            '"Pembeli" bermaksud pengguna yang mencari barangan atau perkhidmatan, menghantar pertanyaan, permintaan atau permintaan sumber.',
            '"Penjual" atau "Perniagaan" bermaksud perniagaan Malaysia yang menyenaraikan dirinya, produk atau perkhidmatan.',
            '"Rakan Kongsi" dan "Pembekal Antarabangsa" bermaksud organisasi yang menawarkan barangan atau perkhidmatan, termasuk dari luar Malaysia, melalui alat sumber.',
            '"Organisasi" bermaksud akaun perniagaan, rakan kongsi atau pembeli yang mempunyai ahli.',
            '"Kandungan" bermaksud apa-apa yang dihantar pengguna: penyenaraian, perihal, mesej, sebut harga, fail, ulasan dan laporan.',
            '"Dasar Pasaran" bermaksud Dasar Pembeli, Penjual dan Pembekal yang diterbitkan bersama terma ini.',
          ],
        },
      ],
    },
    {
      id: 'services',
      title: '3. Apa yang INOK sediakan',
      blocks: [
        { p: 'INOK menyediakan: direktori perniagaan awam dan katalog produk; alat untuk menghantar pertanyaan, permintaan dan permintaan sebut harga; pemesejan antara pembeli dan penjual; rekod sebut harga dan rundingan; aliran kerja sumber pembekal; semakan pengesahan perniagaan; dan Pemandu Bantuan Kerajaan yang menerangkan program awam. INOK membantu pihak-pihak mencari satu sama lain dan merekod apa yang mereka katakan.' },
        { p: 'INOK bukan pihak kepada mana-mana kontrak antara pengguna. INOK tidak menjual, menghantar atau memeriksa barangan, tidak menerima bayaran untuknya dan tidak membekalkan pembiayaan kerajaan.' },
      ],
    },
    {
      id: 'eligibility',
      title: '4. Siapa boleh membuka akaun',
      blocks: [
        { p: 'Anda mesti berumur sekurang-kurangnya [umur minimum: untuk disahkan pengurusan; draf mencadangkan 18] tahun dan berupaya memasuki kontrak mengikat, atau bertindak bagi organisasi yang berupaya. Jika anda bertindak bagi organisasi, anda mengesahkan bahawa anda diberi kuasa (lihat bahagian 10).' },
      ],
    },
    {
      id: 'registration',
      title: '5. Pendaftaran dan ketepatan',
      blocks: [
        { p: 'Anda mesti memberi maklumat yang tepat dan terkini serta mengemas kininya. Anda hanya boleh memegang akaun yang anda berhak memegangnya. Kami boleh menolak atau menutup pendaftaran yang tidak tepat, bertindih atau menyalahgunakan.' },
      ],
    },
    {
      id: 'account-security',
      title: '6. Memastikan akaun anda selamat',
      blocks: [
        { p: 'Rahsiakan kata laluan anda, gunakan kata laluan yang kuat dan hidupkan langkah pengesah jika ditawarkan (ia diwajibkan untuk pentadbir). Maklumkan kami dengan segera di {supportEmail} jika anda fikir akaun anda digunakan tanpa kebenaran. Anda bertanggungjawab atas aktiviti di bawah akaun anda melainkan ia berpunca daripada kegagalan kami mengambil penjagaan munasabah.' },
      ],
    },
    {
      id: 'buyers',
      title: '7. Tanggungjawab pembeli',
      blocks: [
        { p: 'Pembeli mesti menghantar pertanyaan dan permintaan yang tulen dan tepat; berkomunikasi dengan hormat; menggunakan sebut harga dan alat sumber untuk niat pembelian sebenar; dan tidak menggunakan platform untuk penipuan, gangguan atau mengumpul butiran hubungan. Lihat Dasar Pasaran.' },
      ],
    },
    {
      id: 'sellers',
      title: '8. Tanggungjawab penjual',
      blocks: [
        { p: 'Penjual mesti memastikan profil, harga dan perihal tepat; memegang lesen dan pendaftaran yang diperlukan perniagaan mereka; menjawab pertanyaan dengan segera dan jujur; dan menunaikan apa yang mereka janjikan. Penjual yang berdagang melalui platform juga mesti memenuhi kewajipan penzahiran yang terpakai kepada pembekal pasar dalam talian. Lihat Dasar Pasaran.' },
      ],
    },
    {
      id: 'suppliers',
      title: '9. Tanggungjawab pembekal antarabangsa',
      blocks: [
        { p: 'Pembekal dan rakan kongsi antarabangsa mesti memberi maklumat syarikat dan produk yang tepat, menyatakan terma sebut harga dan sebarang caj tambahan dengan jelas, dan kekal bertanggungjawab atas penghantaran, kastam, dokumen import atau eksport, piawaian produk dan aturan pembayaran yang dipersetujui dengan pembeli. Lihat Dasar Pasaran.' },
      ],
    },
    {
      id: 'authority',
      title: '10. Bertindak bagi pihak perniagaan',
      blocks: [
        { p: 'Jika anda mencipta atau mengurus organisasi, anda berjanji bahawa anda mempunyai kuasa untuk mengikatnya dan memberi kami maklumat yang anda berikan. Kami boleh meminta bukti kuasa. Orang yang mendakwa kuasa yang tidak dimilikinya boleh dibuang dan dilaporkan.' },
      ],
    },
    {
      id: 'verification',
      title: '11. Pengesahan perniagaan dan hadnya',
      blocks: [
        { p: 'Pengesahan ialah semakan oleh INOK terhadap maklumat dan dokumen yang dihantar perniagaan. Label "disahkan" bermakna pada tarikh semakan, bukti yang diberikan didapati konsisten. Ia bukan jaminan kualiti, kemampuan kewangan, lesen, produk atau kelakuan perniagaan itu dan bukan sokongan. Pengesahan boleh ditarik balik. Sehingga pengimbas dokumen beroperasi, pengesahan berasaskan dokumen tidak tersedia.' },
      ],
    },
    {
      id: 'listings',
      title: '12. Penyenaraian perniagaan',
      blocks: [
        { p: 'Penyenaraian hanya diterbitkan selepas semakan dan kekal tanggungjawab penjual. Penjual memilih sama ada nombor telefon atau e-mel ditunjukkan secara awam. Kami tidak mengubah kandungan penyenaraian anda tanpa memberitahu anda, tetapi kami boleh menolak, menyembunyikan atau membuang penyenaraian yang melanggar terma ini atau undang-undang.' },
      ],
    },
    {
      id: 'descriptions',
      title: '13. Perihal produk dan perkhidmatan',
      blocks: [
        { p: 'Perihal, imej dan harga mesti benar dan tidak mengelirukan, dan tidak boleh mendakwa kelulusan, pensijilan atau piawaian yang tidak dipegang penjual. Maklumat yang dikehendaki undang-undang untuk barangan atau perkhidmatan mesti ditunjukkan, dan dalam bahasa kebangsaan jika undang-undang memerlukannya.' },
      ],
    },
    {
      id: 'enquiries',
      title: '14. Pertanyaan dan permintaan sebut harga',
      blocks: [
        { p: 'Pertanyaan atau permintaan menjemput jawapan. Ia bukan pesanan. Penjual tidak wajib menjawab atau memberi sebut harga, dan pembeli tidak wajib membeli.' },
      ],
    },
    {
      id: 'quotations',
      title: '15. Sebut harga, rundingan dan penerimaan',
      blocks: [
        { p: 'Sebut harga menyatakan apa yang ditawarkan penjual, dengan tempoh sahnya. Bagi kerja atau barangan yang mempunyai tarikh, sebut harga juga menyatakan terma tempahan yang diminta daripada pembeli untuk diterima: tarikh perkhidmatan atau penghantaran, tarikh siap (pilihan), jangkaan deposit dan syarat pembatalan (satu daripada tiga pilihan standard, atau kata-kata penjual sendiri). Jangkaan deposit hanyalah teks bertulis.' },
        { p: 'Platform merekod setiap versi, permintaan perubahan dan penerimaan pembeli. Pembeli boleh meminta perubahan dan penjual boleh menghantar versi baharu; hanya versi terkini boleh diterima, dan versi terdahulu kekal dalam rekod tanpa diubah.' },
        { p: 'Menerima sebut harga mencipta rekod perjanjian di platform yang mengandungi tepat terma yang diterima. Jika sebut harga mempunyai terma tempahan, terma itu dikunci: tiada pihak boleh menyuntingnya di platform selepas itu. Perubahan memerlukan sebut harga baharu, jadi batalkan perjanjian dahulu jika kedua-dua pihak bersetuju. Perjanjian yang dibuat sebelum terma tempahan wujud mungkin masih boleh ditambah tarikh atau nota deposit oleh penjual.' },
        { p: 'Rekod perjanjian bukan resit, invois, bukti pembayaran, bukti penghantaran atau jaminan INOK. Pembekalan barangan atau perkhidmatan, penghantaran dan pembayaran berlaku antara pihak-pihak di luar platform. Semak harga akhir, cukai dan kos penghantaran sebelum anda menerima.' },
      ],
    },
    {
      id: 'agreements',
      title: '15A. Kemajuan pesanan dan pembatalan',
      blocks: [
        { p: 'Selepas penerimaan, perjanjian melalui langkah berikut di platform: dipersetujui; kerja dimulakan (ditanda oleh penjual); dihantar, menunggu pengesahan pembeli (ditanda oleh penjual dengan nota); selesai (disahkan oleh pembeli); atau dibatalkan. Mana-mana pihak boleh membatalkan semasa perjanjian masih "dipersetujui" sahaja, dan boleh menambah nota.' },
        { p: 'Syarat pembatalan dan jangkaan deposit dalam sebut harga ialah pengaturan antara pembeli dan penjual. INOK tidak menggunakan, mengira, memungut, memegang, memulangkan atau mengesahkan sebarang deposit atau fi, dan platform tidak pernah menanda perjanjian sebagai dibayar atau dilindungi. Pengesahan penghantaran hanya merekod pengesahan pembeli; ia bukan bukti kualiti atau pembayaran.' },
      ],
    },
    {
      id: 'sourcing',
      title: '16. Aliran kerja sumber pembekal',
      blocks: [
        { p: 'Alat sumber membolehkan pembeli menghantar permintaan kepada rakan kongsi terpilih, menerima sebut harga dan tawaran balas, meminta sampel dan memilih sebut harga pilihan. Pilihan itu ialah rekod pilihan pembeli. Ia bukan kontrak oleh INOK dan tidak mewajibkan INOK melakukan apa-apa.' },
      ],
    },
    {
      id: 'delivery',
      title: '17. Penghantaran dan penunaian',
      blocks: [
        { p: 'Penghantaran, pemasangan, pemulangan, waranti dan perkhidmatan lepas jualan ialah tanggungjawab penjual atau pembekal dan dikawal oleh perjanjian antara pembeli dan penjual. INOK tidak menghantar, menyimpan atau memeriksa barangan.' },
      ],
    },
    {
      id: 'payments',
      title: '18. Pembayaran',
      blocks: [
        { p: 'INOK pada masa ini tidak memproses pembayaran. Apa-apa pembayaran diatur terus antara pembeli dan penjual di luar platform. Berhati-hati semasa membayar, semak kepada siapa anda membayar dan simpan rekod.' },
        { p: 'Jangkaan deposit atau syarat pembatalan yang ditulis dalam sebut harga ialah teks yang dipersetujui antara pihak-pihak. INOK tidak memungut, memegang, menjejak atau mengesahkan sebarang deposit atau pembayaran.' },
      ],
    },
    {
      id: 'no-escrow',
      title: '19. Tiada eskrow dan tiada jaminan pembayaran',
      blocks: [
        { p: 'INOK tidak menyediakan eskrow, perlindungan pembayaran, jaminan bayaran balik atau insurans. INOK tidak boleh memaksa penjual membayar balik, menghantar atau menunaikan, dan tidak menjamin urus niaga akan berjaya. Jika INOK kelak menawarkan ciri pembayaran, terma berasingan akan terpakai dan bahagian ini akan dikemas kini.' },
      ],
    },
    {
      id: 'no-outcomes',
      title: '20. Tiada hasil dijamin',
      blocks: [
        { p: 'INOK tidak menjanjikan petunjuk jualan, jualan, pesanan, pembiayaan, geran, pinjaman, kelulusan atau apa-apa hasil perniagaan. Contoh yang ditunjukkan di platform ialah ilustrasi, bukan janji.' },
      ],
    },
    {
      id: 'prohibited',
      title: '21. Kelakuan dan penyenaraian yang dilarang',
      blocks: [
        {
          ul: [
            'barangan atau perkhidmatan yang haram, palsu, dicuri, tidak selamat atau memerlukan lesen yang tidak dipegang penjual;',
            'tawaran yang mengelirukan, memperdaya atau menipu, ulasan palsu atau perniagaan palsu;',
            'menyamar sebagai orang atau perniagaan, atau mendakwa sokongan kerajaan yang tidak wujud;',
            'menghantar perisian hasad, mengikis data, menduga atau memintas keselamatan, atau membebankan platform;',
            'mengumpul atau menyalahgunakan data peribadi pengguna lain;',
            'gangguan, ucapan kebencian atau penderaan;',
            'membawa pengguna keluar daripada platform untuk mengelak peraturannya bagi menipu mereka.',
          ],
        },
      ],
    },
    {
      id: 'content',
      title: '22. Kandungan yang anda hantar',
      blocks: [
        { p: 'Anda kekal memiliki kandungan anda. Anda memberi INOK lesen bukan eksklusif, bebas royalti untuk menghoskan, memaparkan, menyalin dan memprosesnya seperti diperlukan untuk menjalankan platform bagi anda dan pengguna yang anda pilih untuk berkongsi, dan (untuk penyenaraian awam) menunjukkannya secara awam semasa diterbitkan. Anda berjanji bahawa anda berhak menghantarnya dan ia tidak melanggar hak sesiapa atau undang-undang. Kami boleh membuang kandungan yang melanggar terma ini.' },
      ],
    },
    {
      id: 'ip',
      title: '23. Harta intelek',
      blocks: [
        { p: 'Platform, reka bentuknya, nama dan logo INOK serta teks kami sendiri dimiliki oleh {company} atau pemberi lesennya. Anda tidak boleh menyalin atau menggunakannya semula kecuali seperti dibenarkan terma ini. Nama dan logo agensi kerajaan dimiliki oleh agensi itu dan tidak dilesenkan kepada anda atau INOK oleh terma ini.' },
      ],
    },
    {
      id: 'complaints',
      title: '24. Aduan dan pelaporan',
      blocks: [
        { p: 'Anda boleh melaporkan penyenaraian, produk, ulasan atau permintaan daripada halaman tempat anda melihatnya (apabila log masuk), dan menghantar sebarang aduan ke {supportEmail}. Proses kami terdapat dalam halaman Aduan dan Piawaian Komuniti.' },
      ],
    },
    {
      id: 'order-issues',
      title: '24A. Melaporkan isu dengan perjanjian',
      blocks: [
        { p: 'Semasa kerja sedang dijalankan atau menunggu pengesahan, pembeli boleh melaporkan isu pada perjanjian dengan memilih sebab (tidak dihantar, tidak seperti dipersetujui, pihak lain tidak hadir, atau sebab lain) dan menerangkan apa yang berlaku. Penjual dimaklumkan, laporan direkodkan pada perjanjian, dan kakitangan INOK yang diberi kuasa boleh melihatnya dalam senarai baca sahaja.' },
        { p: 'INOK tidak memutuskan siapa yang betul, tidak memegang atau memindahkan wang dan tidak boleh mengarahkan bayaran balik, penghantaran atau pelaksanaan. Melaporkan isu di platform bukan tuntutan undang-undang dan tidak menggantikan remedi anda yang lain (lihat bahagian 24 dan halaman Aduan dan Standard Komuniti).' },
      ],
    },
    {
      id: 'suspension',
      title: '25. Penggantungan dan penamatan',
      blocks: [
        { p: 'Kami boleh menggantung atau menamatkan akaun, membuang kandungan atau menarik balik pengesahan jika anda melanggar terma ini atau undang-undang, jika kami mesti berbuat demikian di sisi undang-undang, atau untuk melindungi pengguna. Jika munasabah kami akan memberitahu sebabnya dan cara memberi maklum balas. Anda boleh menutup akaun pada bila-bila masa melalui permintaan data atau dengan menghubungi kami; rekod yang mesti kami simpan kekal seperti diterangkan dalam Notis Privasi.' },
      ],
    },
    {
      id: 'data-protection',
      title: '26. Data peribadi',
      blocks: [{ p: 'Notis Privasi kami menerangkan cara kami mengendalikan data peribadi dan hak anda. Anda mesti mengendalikan data peribadi orang lain yang anda terima melalui platform (contohnya butiran hubungan pembeli atau pembekal) secara sah dan hanya untuk tujuan ia diberikan.' }],
    },
    {
      id: 'incidents',
      title: '27. Insiden keselamatan',
      blocks: [{ p: 'Laporkan masalah keselamatan atau akses tanpa kebenaran yang disyaki ke {supportEmail}. Kami akan menyiasat, mengambil langkah mengawal masalah dan memaklumkan pihak berkuasa serta individu terjejas jika undang-undang memerlukan.' }],
    },
    {
      id: 'availability',
      title: '28. Ketersediaan',
      blocks: [{ p: 'Kami berusaha memastikan platform tersedia tetapi tidak menjanjikan ia tidak terganggu atau bebas ralat. Kami boleh menggantung ciri untuk penyelenggaraan, keselamatan atau sebab undang-undang. Sesetengah ciri (contohnya pemberitahuan e-mel dan muat naik dokumen) mungkin belum aktif.' }],
    },
    {
      id: 'links',
      title: '29. Pautan pihak ketiga',
      blocks: [{ p: 'Platform memaut ke laman web kerajaan dan lain-lain yang tidak kami kawal. Kami tidak bertanggungjawab atas kandungan atau amalan mereka. Sentiasa gunakan saluran rasmi untuk permohonan rasmi.' }],
    },
    {
      id: 'disclaimers',
      title: '30. Penafian',
      blocks: [
        { p: 'Tertakluk kepada bahagian 31 dan hak yang diberikan undang-undang kepada anda dan tidak boleh dikecualikan, platform disediakan "seadanya" dan "mengikut ketersediaan". Pengguna, bukan INOK, membekalkan penyenaraian, sebut harga dan maklumat, dan INOK tidak menjamin ia tepat, sah atau sesuai.' },
      ],
    },
    {
      id: 'liability',
      title: '31. Liabiliti',
      blocks: [
        { p: 'Tiada apa dalam terma ini yang mengecualikan atau menghadkan liabiliti atau hak yang tidak boleh dikecualikan atau dihadkan secara sah di bawah undang-undang Malaysia, termasuk hak pengguna di bawah Akta Perlindungan Pengguna 1999. [Pengurusan dan peguam untuk menentukan had liabiliti INOK bagi pengguna perniagaan, yang mestilah munasabah dan sah.]' },
      ],
    },
    {
      id: 'disputes',
      title: '32. Pertikaian',
      blocks: [
        { p: 'Pertikaian antara pengguna ialah urusan antara pengguna itu. INOK boleh membantu berkomunikasi tetapi tidak boleh memutuskannya. Bagi pertikaian dengan INOK, tulis dahulu ke {supportEmail}; kami akan cuba menyelesaikannya dengan suci hati. [Klausa pengantaraan atau timbang tara: untuk diputuskan pengurusan dan peguam.] Pengguna kekal berhak menggunakan Tribunal Tuntutan Pengguna dan mahkamah jika undang-undang memberi hak itu.' },
      ],
    },
    {
      id: 'governing-law',
      title: '33. Undang-undang dan bidang kuasa',
      blocks: [{ p: 'Terma ini dikawal oleh undang-undang Malaysia. Tertakluk kepada sebarang peraturan undang-undang mandatori, mahkamah Malaysia mempunyai bidang kuasa. [Sahkan dengan peguam.]' }],
    },
    {
      id: 'amendments',
      title: '34. Perubahan pada terma ini',
      blocks: [{ p: 'Kami boleh mengubah terma ini. Kami akan menyiarkan versi baharu dengan tarikhnya dan memberitahu pengguna yang log masuk tentang perubahan ketara. Jika perubahan memerlukannya, anda akan diminta menerima semula sebelum meneruskan. Jika anda tidak menerima, anda boleh menutup akaun anda.' }],
    },
    {
      id: 'contact',
      title: '35. Hubungan',
      blocks: [{ p: 'Pengendali: {company} (SSM {ssm}), {address}. Sokongan: {supportEmail}. Privasi: {privacyEmail}.' }],
    },
  ],
};
