import type { LegalDocument } from '@/lib/legal';

export const privacy: LegalDocument = {
  title: 'Notis Privasi',
  intro:
    'Notis ini menerangkan data peribadi yang dikumpul oleh INOK, sebabnya, siapa yang boleh melihatnya, di mana ia disimpan, tempoh penyimpanan dan cara anda menggunakan hak anda di bawah Akta Perlindungan Data Peribadi 2010 Malaysia. Ia menerangkan apa yang sebenarnya dilakukan oleh platform hari ini. Ini ialah draf untuk semakan pengurusan dan peguam dan belum berkuat kuasa.',
  sections: [
    {
      id: 'operator',
      title: '1. Siapa kami',
      blocks: [
        { p: 'INOK ("kami") dikendalikan oleh:' },
        {
          table: {
            head: ['Perkara', 'Butiran'],
            rows: [
              ['Nama syarikat berdaftar', '{company}'],
              ['Nombor pendaftaran SSM', '{ssm}'],
              ['Alamat perniagaan berdaftar', '{address}'],
              ['Hubungan privasi', '{privacyEmail}'],
              ['Sokongan pelanggan', '{supportEmail}'],
              ['Pegawai Perlindungan Data', '{dpo}'],
              ['Tarikh berkuat kuasa', '{effective}'],
              ['Dikemas kini', '{updated}'],
            ],
          },
        },
        { p: 'Bagi data peribadi yang diterangkan dalam notis ini, kami bertindak sebagai pengawal data. "Platform" bermaksud laman web dan aplikasi INOK.' },
      ],
    },
    {
      id: 'scope',
      title: '2. Siapa yang dilindungi notis ini',
      blocks: [
        {
          ul: [
            'pelawat yang melayari direktori awam, katalog, berita dan halaman bantuan kerajaan tanpa akaun;',
            'pembeli berdaftar;',
            'pemilik perniagaan Malaysia dan penjual, serta kakitangan atau pengurus yang mereka tambah;',
            'wakil perniagaan yang diberi kuasa;',
            'pembekal antarabangsa dan organisasi rakan kongsi yang mewakili mereka;',
            'pentadbir dan penyemak INOK.',
          ],
        },
        { p: 'Notis ini meliputi data peribadi individu. Maklumat yang hanya tentang syarikat (contohnya nama perniagaan atau perihal produk) ialah maklumat perniagaan, tetapi sering mengenal pasti seseorang (contohnya pemilik tunggal atau kenalan bernama) dan kami melayannya dengan penjagaan yang sama.' },
      ],
    },
    {
      id: 'data-collected',
      title: '3. Data peribadi yang kami kumpul',
      blocks: [
        { p: 'Kami hanya mengumpul apa yang diperlukan oleh sesuatu ciri. Jadual menyenaraikan apa yang sebenarnya dikumpul platform hari ini.' },
        {
          table: {
            head: ['Data', 'Sumber', 'Wajib?'],
            rows: [
              ['Nama (nama paparan), alamat e-mel, kata laluan (disimpan hanya sebagai cincang terlindung oleh perkhidmatan pengesahan kami), bahasa pilihan', 'Anda, semasa pendaftaran dan dalam akaun anda', 'Wajib untuk memiliki akaun'],
              ['Rekod penerimaan: versi Terma dan Notis Privasi yang anda terima dan bila; persetujuan pemasaran pilihan dan penarikannya', 'Anda', 'Terma dan privasi: wajib. Pemasaran: pilihan'],
              ['Peranan dan keahlian organisasi (pemilik, pengurus, kakitangan, pentadbir)', 'Anda dan pemilik organisasi anda', 'Wajib untuk menggunakan ciri organisasi'],
              ['Butiran perniagaan: nama perniagaan, kategori, status pendaftaran, nombor SSM, jenis perniagaan, negeri, daerah, alamat jalan dan poskod, telefon dan e-mel perniagaan', 'Anda atau wakil yang diberi kuasa', 'Wajib untuk penyenaraian dan pengesahan; alamat jalan dan butiran hubungan disimpan secara persendirian melainkan anda memilih untuk menunjukkan telefon atau e-mel secara awam'],
              ['Butiran wakil: nama penuh, peranan, telefon dan e-mel orang yang diberi kuasa bertindak bagi pihak perniagaan', 'Perniagaan', 'Wajib untuk pengesahan'],
              ['Bukti pengesahan: dokumen yang anda muat naik (contohnya pendaftaran perniagaan, bukti lokasi, bukti kuasa) serta nota dan keputusan semakan', 'Anda dan penyemak INOK', 'Hanya jika anda memohon status disahkan. Muat naik hanya yang diminta. Kami tidak memerlukan imej kad pengenalan anda dan memohon anda tidak menghantarnya'],
              ['Penyenaraian, produk, perkhidmatan, harga, perihal portfolio, foto', 'Penjual dan rakan kongsi', 'Kandungan pilihan yang anda terbitkan'],
              ['Pertanyaan, mesej, sebut harga, sejarah rundingan, ulasan, laporan yang anda failkan', 'Pembeli dan penjual', 'Dicipta apabila anda menggunakan ciri ini'],
              ['Permintaan pembeli, termasuk butiran hubungan hanya jika anda memilih untuk berkongsi', 'Pembeli', 'Perkongsian hubungan adalah pilihan'],
              ['Rekod sumber: item, kuantiti, nota, sebut harga, tawaran balas, permintaan sampel, mesej dan lampiran', 'Pembeli dan pembekal atau rakan kongsi antarabangsa', 'Dicipta apabila anda menggunakan sumber'],
              ['Rekod pembekal: nama pembekal, nama, e-mel dan telefon hubungan persendirian, pengecam pendaftaran, laman web, keupayaan, dokumen sokongan', 'Rakan kongsi dan pembekal', 'Wajib untuk menyenaraikan pembekal'],
              ['Maklumat bantuan kerajaan: keperluan perniagaan, status pendaftaran dan kewarganegaraan seperti yang anda masukkan, program tersimpan, nota dan status penjejakan permohonan, pilihan peringatan', 'Anda', 'Pilihan; digunakan hanya untuk membimbing anda'],
              ['Pilihan pemberitahuan dan berita, pemberitahuan dalam aplikasi', 'Anda dan sistem', 'Pilihan'],
              ['Rekod keselamatan dan audit: log masuk, log keluar, penukaran kata laluan dan tindakan pentadbiran dengan masa dan akaun; pembilang had kadar untuk menghalang penyalahgunaan', 'Sistem', 'Dicipta secara automatik'],
              ['Data teknikal: platform sendiri tidak menyimpan alamat IP dalam pangkalan datanya. Penyedia pengehosan kami memproses alamat IP dan metadata permintaan untuk menyampaikan dan melindungi laman (lihat bahagian 7)', 'Peranti anda', 'Dicipta secara automatik'],
              ['Rekod perjanjian dan pesanan: rujukan, sebut harga yang diterima (item, skop, harga, terma tempahan: tarikh, tarikh siap, teks jangkaan deposit, syarat pembatalan), status, sejarah langkah beserta masa, dan nota serta sebab yang anda tulis semasa menghantar, membatalkan atau melaporkan isu', 'Pembeli dan penjual', 'Dicipta apabila sebut harga diterima atau perjanjian diambil tindakan'],
            ],
          },
        },
        { p: 'Kami tidak sengaja mengumpul data biometrik, nombor kad bank atau kata laluan untuk perkhidmatan lain. Sila jangan masukkannya dalam mesej, nota atau muat naik.' },
      ],
    },
    {
      id: 'purposes',
      title: '4. Mengapa kami menggunakan data anda',
      blocks: [
        {
          table: {
            head: ['Tujuan', 'Asas'],
            rows: [
              ['Mencipta dan melindungi akaun anda; log masuk; pemulihan kata laluan; memastikan sesi selamat', 'Diperlukan untuk menyediakan perkhidmatan yang anda minta'],
              ['Orientasi perniagaan, penyenaraian dan penemuan; menunjukkan bahagian awam profil anda', 'Diperlukan untuk perkhidmatan; anda memilih apa yang menjadi awam'],
              ['Pengesahan perniagaan dan wakilnya; semakan pentadbiran dan penyederhanaan', 'Diperlukan untuk perkhidmatan; kepentingan sah dalam pasaran yang dipercayai; kewajipan undang-undang'],
              ['Komunikasi pembeli-penjual, sebut harga, pemadanan pembekal dan aliran kerja sumber', 'Diperlukan untuk perkhidmatan yang anda minta'],
              ['Pemadanan bantuan kerajaan, program tersimpan dan penjejakan permohonan', 'Permintaan anda; maklumat yang anda masukkan adalah pilihan'],
              ['Pencegahan penipuan, kawalan penyalahgunaan, pemantauan keselamatan dan tindak balas insiden', 'Kepentingan sah; kewajipan undang-undang'],
              ['Sokongan pelanggan dan pengendalian aduan serta permintaan data', 'Diperlukan untuk membalas anda'],
              ['Penambahbaikan perkhidmatan daripada kiraan agregat atau tanpa identiti', 'Kepentingan sah'],
              ['Mesej pemasaran pilihan tentang INOK', 'Persetujuan anda; tidak pernah dipilih terlebih dahulu dan boleh ditarik balik pada bila-bila masa'],
              ['Menyimpan rekod yang dikehendaki undang-undang (lihat bahagian 10)', 'Kewajipan undang-undang'],
              ['Merekod perjanjian, kemajuan pesanan dan isu yang dilaporkan, serta memaklumkan pihak lain', 'Diperlukan untuk menyediakan perkhidmatan yang anda minta; kepentingan sah dalam menangani masalah'],
            ],
          },
        },
        { note: 'Nota pengurusan: Akta Perlindungan Data Peribadi 2010 dibina atas persetujuan dan senarai asas yang dibenarkan, bukan model asas sah undang-undang lain. Lajur "asas" ialah pemetaan bahasa mudah untuk semakan peguam, bukan pendapat undang-undang.' },
      ],
    },
    {
      id: 'sources',
      title: '5. Dari mana maklumat datang',
      blocks: [
        {
          ul: [
            'terus daripada anda;',
            'daripada wakil yang diberi kuasa atau rakan sekerja yang menambah anda ke organisasi atau jemputan;',
            'daripada peserta lain, contohnya pembeli yang menghantar pertanyaan atau penyemak yang merekod keputusan;',
            'daripada dokumen yang anda muat naik;',
            'daripada aktiviti anda di platform (mesej, sebut harga, item tersimpan, rekod audit);',
            'daripada maklumat perniagaan awam yang dipilih penjual untuk diterbitkan;',
            'daripada sumber rasmi program kerajaan untuk halaman Bantuan Kerajaan. Ini menerangkan program, bukan individu.',
          ],
        },
        { p: 'Kami tidak membeli data peribadi atau menggabungkannya dengan profil pengiklanan luar.' },
      ],
    },
    {
      id: 'sharing',
      title: '6. Siapa boleh melihat maklumat anda',
      blocks: [
        { p: 'Sebahagian maklumat adalah awam, sebahagian dikongsi dengan pihak lain dalam urus niaga dan sebahagian persendirian. Kami tidak menjual data peribadi.' },
        {
          table: {
            head: ['Siapa', 'Apa yang boleh dilihat'],
            rows: [
              ['Sesiapa (awam)', 'Bahagian penyenaraian perniagaan dan halaman produk yang diterbitkan penjual: nama perniagaan, perihal, kategori, negeri, produk dan, hanya jika penjual memilih, telefon atau e-mel perniagaan. Ulasan yang diluluskan. Maklumat program awam.'],
              ['Pihak lain dalam urutan pertanyaan, sebut harga, permintaan atau sumber', 'Mesej, sebut harga dan lampiran dalam urutan itu dan butiran hubungan yang anda pilih untuk dikongsi. Pembeli yang menghantar pertanyaan semestinya berkongsi pertanyaan itu dengan penjual; penjual yang menjawab permintaan semestinya berkongsi jawapan dengan pembeli.'],
              ['Rakan kongsi dan pembekal antarabangsa yang dipadankan dengan anda', 'Butiran permintaan sumber yang anda hantar. Jika anda memasukkan butiran peribadi, mereka menerimanya. Lihat bahagian 8.'],
              ['Organisasi anda', 'Pemilik dan pengurus boleh melihat ahli, peranan dan rekod organisasi mengikut peranan mereka.'],
              ['Kakitangan INOK yang diberi kuasa', 'Hanya yang diperlukan peranan mereka: penyemak melihat bukti pengesahan; pentadbir dengan kebenaran berkaitan mengendalikan laporan, permintaan data dan senarai baca sahaja bagi isu yang dilaporkan pada perjanjian. Akaun pentadbir memerlukan langkah pengesahan kedua dan tindakan mereka direkod.'],
              ['Penyedia perkhidmatan (pemproses)', 'Cloudflare (pengehosan dan penyampaian) dan Supabase (pangkalan data, pengesahan, storan fail persendirian). Penyedia e-mel transaksi akan ditambah apabila e-mel dilancarkan; notis ini akan dikemas kini sebelum itu.'],
              ['Pihak berkuasa', 'Apabila dikehendaki undang-undang atau pihak berkuasa yang berwibawa memintanya secara sah, dan untuk melindungi hak, keselamatan atau daripada penipuan.'],
              ['Pihak lain dalam perjanjian', 'Perjanjian, termanya, sejarah langkah dan nota serta laporan isu di dalamnya. Setiap pihak hanya melihat perjanjian yang ia menjadi pihak kepadanya.'],
            ],
          },
        },
        { p: 'Maklumat akaun persendirian (alamat e-mel, cincang kata laluan, dokumen pengesahan, alamat perniagaan persendirian dan butiran hubungan persendirian) tidak ditunjukkan kepada pengguna lain, kecuali anda memilih untuk berkongsi.' },
      ],
    },
    {
      id: 'transfers',
      title: '7. Pemindahan ke luar Malaysia',
      blocks: [
        { p: 'Data anda diproses di luar Malaysia:' },
        {
          ul: [
            'Pangkalan data pengeluaran, perkhidmatan pengesahan dan storan fail persendirian kami dihoskan oleh Supabase di Tokyo, Jepun (AWS ap-northeast-1).',
            'Aplikasi berjalan di rangkaian global Cloudflare yang memproses permintaan (termasuk alamat IP) di pusat data terdekat dengan pelawat.',
            'Pembekal dan rakan kongsi antarabangsa mungkin berada di negara lain, contohnya India (lihat bahagian 8).',
          ],
        },
        { p: 'Di bawah Akta Perlindungan Data Peribadi 2010 seperti dipinda pada 2024, pengawal data boleh memindahkan data peribadi ke luar negara jika destinasi mempunyai undang-undang yang sebahagian besarnya serupa dengan Akta atau menjamin tahap perlindungan yang mencukupi, atau syarat lain dalam Akta dipenuhi. Pesuruhjaya telah menerbitkan panduan pemindahan rentas sempadan. {company} belum melengkapkan penilaian pemindahan untuk Jepun, lokasi Cloudflare dan negara pembekal, dan belum merekod terma pemproses untuk semakan. Kami tidak akan menyifatkan pemindahan itu sebagai patuh sehingga penilaian itu selesai.' },
        { note: 'Tindakan pengurusan: lengkapkan penilaian pemindahan dan sahkan perjanjian pemproses (Supabase, Cloudflare). Lihat matriks kebolehpakaian undang-undang.' },
      ],
    },
    {
      id: 'international-suppliers',
      title: '8. Pembekal antarabangsa dan rakan kongsi sumber',
      blocks: [
        { p: 'Apabila pembeli menghantar permintaan sumber atau pertanyaan kepada rakan kongsi atau pembekal antarabangsa, penerima menerima kandungan permintaan itu: item, kuantiti, nota, lampiran dan nama organisasi pembeli. Jika pembeli menulis butiran peribadi dalam nota, penerima menerimanya. Penerima menentukan cara menggunakan maklumat itu untuk perniagaan mereka dan bertanggungjawab mengendalikannya secara sah di negara mereka. INOK tidak mengawal sistem penerima. Pembeli patut menghantar hanya apa yang diperlukan pembekal untuk membuat sebut harga.' },
      ],
    },
    {
      id: 'security',
      title: '9. Cara kami melindungi data (yang sedia ada hari ini)',
      blocks: [
        {
          ul: [
            'log masuk dengan kata laluan sekurang-kurangnya 10 aksara termasuk huruf besar, huruf kecil dan angka; percubaan log masuk dihadkan kadarnya;',
            'langkah pengesahan kedua (aplikasi pengesah) diwajibkan untuk akaun pentadbir dan penyemak dan tersedia untuk semua orang;',
            'akses berasaskan peranan dan keselamatan peringkat baris dalam pangkalan data, supaya rekod setiap organisasi diasingkan, diuji secara automatik;',
            'storan persendirian untuk dokumen pengesahan: tiada pautan awam, akses jangka pendek hanya untuk yang diberi kuasa;',
            'fail yang dimuat naik disemak jenis dan saiz; fail yang belum diimbas untuk perisian hasad ditahan dalam kuarantin dan tidak boleh diluluskan atau dimuat turun. Pengimbas perisian hasad belum beroperasi, maka pengesahan berasaskan dokumen belum dibuka;',
            'sambungan disulitkan (HTTPS) untuk semua trafik;',
            'log audit log masuk dan tindakan pentadbiran, disimpan dalam bentuk yang tidak boleh diubah oleh kakitangan;',
            'sistem pementasan dan pengeluaran yang berasingan dengan pangkalan data dan rahsia berasingan.',
          ],
        },
        { p: 'Kami tidak menjanjikan mana-mana sistem selamat sepenuhnya. Kami belum memperoleh pensijilan keselamatan luaran. Pangkalan data pengeluaran berada pada pelan tanpa sandaran automatik pada masa penulisan; kami menyimpan sandaran manual yang diuji (lihat bahagian 10) dan akan mengemas kini notis ini jika ia berubah.' },
        { p: 'Jika pelanggaran data peribadi berlaku, kami akan menilainya, memaklumkan Pesuruhjaya Perlindungan Data Peribadi seperti dikehendaki undang-undang dan memberitahu individu terjejas jika pelanggaran itu berkemungkinan menyebabkan kemudaratan yang ketara.' },
      ],
    },
    {
      id: 'retention',
      title: '10. Tempoh penyimpanan data (cadangan, untuk kelulusan pengurusan)',
      blocks: [
        { p: 'Undang-undang menetapkan tempoh hanya untuk sesetengah rekod. Jika tidak, tempoh di bawah ialah cadangan dengan sebabnya. Ia bukan jadual pengekalan yang diluluskan sehingga pengurusan mengesahkannya.' },
        {
          table: {
            head: ['Kategori', 'Tempoh dicadangkan', 'Sebab'],
            rows: [
              ['Data akaun (nama, e-mel, pilihan)', 'Selagi akaun dibuka; dipadam atau dinyahkenal dalam 30 hari selepas permintaan penutupan disahkan, tertakluk kepada baris di bawah', 'Tidak diperlukan lagi selepas akaun ditutup'],
              ['Profil perniagaan dan penyenaraian', 'Selagi aktif; dibuang daripada paparan awam apabila ditutup; butiran persendirian dipadam selepas tempoh rekod pembekal di bawah', 'Penyampaian perkhidmatan'],
              ['Rekod pasaran dan pembekal (butiran identiti dan hubungan, butiran akaun perniagaan, nombor pendaftaran, rekod urus niaga dan pengiklanan)', '3 tahun', 'Peraturan-Peraturan Perlindungan Pengguna (Urus Niaga Perdagangan Elektronik) 2024, peraturan 8, mewajibkan pengendali pasar menyimpan rekod pembekal selama tiga tahun'],
              ['Sebut harga dan rekod sumber', '3 tahun selepas aktiviti terakhir', 'Bukti pertikaian dan peraturan rekod pembekal'],
              ['Mesej (pertanyaan, sumber)', '3 tahun selepas urutan ditutup', 'Bukti pertikaian; dicadangkan'],
              ['Dokumen pengesahan dan keputusan semakan', 'Dokumen: dipadam 12 bulan selepas pengesahan tamat atau akaun ditutup, melainkan pertikaian atau permintaan undang-undang memerlukan lebih lama; rekod keputusan: 3 tahun', 'Meminimumkan bukti sensitif; dicadangkan'],
              ['Log keselamatan dan audit', '24 bulan', 'Keperluan siasatan dan rekod pelanggaran; dicadangkan. Rekod pemberitahuan pelanggaran disimpan sekurang-kurangnya 2 tahun di bawah Pekeliling Pesuruhjaya 2/2025'],
              ['Penjejakan program kerajaan (program tersimpan, nota)', 'Selagi akaun dibuka; dipadam bersamanya', 'Bantuan perancangan peribadi'],
              ['Permintaan sokongan dan permintaan data', '3 tahun selepas ditutup', 'Menunjukkan permintaan dijawab; dicadangkan'],
              ['Sandaran', 'Sandaran manual disimpan sehingga 90 hari kemudian dimusnahkan; pemadaman sampai ke sandaran mengikut kitaran itu', 'Pemulihan; dicadangkan'],
              ['Rekod persetujuan pemasaran', 'Selagi perlu untuk membuktikan persetujuan atau penarikannya', 'Akauntabiliti'],
              ['Rekod perjanjian dan pesanan', 'Cadangan: 3 tahun selepas perjanjian selesai atau dibatalkan; belum diluluskan. Cara perjanjian dikendalikan apabila satu pihak memadam akaunnya ialah keputusan pengurusan dan undang-undang yang belum dibuat (lihat bahagian 11)', 'Bukti untuk pihak lain dan untuk pertikaian; selaras dengan peraturan rekod pasaran tiga tahun'],
            ],
          },
        },
      ],
    },
    {
      id: 'rights',
      title: '11. Hak anda dan cara menggunakannya',
      blocks: [
        { p: 'Di bawah Akta Perlindungan Data Peribadi 2010 anda boleh:' },
        {
          ul: [
            'meminta akses kepada data peribadi anda yang kami simpan;',
            'meminta pembetulan jika data tidak tepat, tidak lengkap atau lapuk;',
            'meminta kami menghadkan atau menghentikan pemprosesan, atau menarik balik persetujuan (contohnya pemasaran) pada bila-bila masa;',
            'meminta kami memindahkan data peribadi anda kepada pengawal data lain pilihan anda jika boleh dilaksanakan secara teknikal (kebolehpindahan data, diperkenalkan pindaan 2024, tertakluk kepada tempoh dan peraturan yang ditetapkan Pesuruhjaya);',
            'meminta pemadaman data yang tidak diperlukan lagi. Pemadaman tidak sentiasa boleh: kami mesti menyimpan apa yang dikehendaki undang-undang (bahagian 10) dan apa yang diperlukan untuk pertikaian atau siasatan yang masih terbuka;',
            'membuat aduan kepada kami, dan kepada Pesuruhjaya Perlindungan Data Peribadi.',
          ],
        },
        { p: 'Pengguna yang log masuk boleh menghantar permintaan daripada Akaun saya, di bawah "Permintaan data anda". Yang lain boleh menghantar e-mel ke {privacyEmail}. Kami akan mengesahkan identiti anda, merekod permintaan dan berusaha membalas dalam 21 hari. Kami boleh menolak permintaan dalam kes yang dibenarkan Akta dan akan menerangkan sebabnya.' },
        { p: 'Memadam data yang berkaitan dengan perjanjian: pihak lain dalam perjanjian mempunyai kepentingan sah terhadap rekodnya. Pemadaman akaun kini dikendalikan oleh kakitangan satu permintaan pada satu masa, dan platform belum dapat melengkapkan pemadaman secara automatik jika perjanjian wujud. Pihak pengurusan sedang memutuskan bagaimana ini akan berfungsi (hala tuju yang dicadangkan ialah menyimpan perjanjian untuk pihak lain sambil membuang data peribadi anda). Sehingga ia diputuskan kami akan memberitahu anda dengan tepat apa yang boleh dan tidak boleh dibuang, dan kami tidak akan memberitahu bahawa data anda telah dipadam melainkan ia benar-benar telah dipadam.' },
      ],
    },
    {
      id: 'marketing',
      title: '12. Mesej yang kami hantar kepada anda',
      blocks: [
        {
          table: {
            head: ['Jenis', 'Contoh', 'Boleh menolak?'],
            rows: [
              ['Mesej akaun dan keselamatan penting', 'Pengesahan e-mel, pemulihan kata laluan, notis keselamatan, perubahan pada terma ini', 'Tidak: ia diperlukan untuk menjalankan akaun anda'],
              ['Pemberitahuan berkaitan urus niaga', 'Jawapan kepada pertanyaan anda, sebut harga, keputusan pengesahan, peringatan yang anda minta', 'Anda boleh mengawal sebahagiannya dalam pilihan pemberitahuan'],
              ['Pemasaran pilihan', 'Berita tentang ciri dan tawaran INOK', 'Ya. Tidak pernah dihidupkan untuk anda. Tandakan kotak semasa pendaftaran atau dalam Akaun saya, dan nyahtanda pada bila-bila masa'],
            ],
          },
        },
        { p: 'Menolak pemasaran tidak pernah menghadkan akses anda ke platform. Penghantaran e-mel belum aktif; tiada e-mel dalam apa jua jenis dihantar sehingga perkhidmatan e-mel dilancarkan.' },
      ],
    },
    {
      id: 'cookies',
      title: '13. Kuki',
      blocks: [{ p: 'Kami hanya menggunakan kuki yang diperlukan untuk log masuk anda dan mengingati bahasa anda. Kami tidak menggunakan kuki pengiklanan atau analitik. Butiran terdapat dalam Dasar Kuki.' }],
    },
    {
      id: 'age',
      title: '14. Kanak-kanak dan kelayakan',
      blocks: [
        { p: 'INOK ialah platform perniagaan. [Umur minimum akaun: untuk disahkan pengurusan; draf ini mencadangkan 18 tahun, atau umur dewasa yang diperlukan untuk memasuki kontrak mengikat.] Kami tidak sengaja mengumpul data peribadi kanak-kanak. Jika anda percaya seorang kanak-kanak telah memberi data kepada kami, hubungi {privacyEmail} dan kami akan membuangnya.' },
      ],
    },
    {
      id: 'complaints',
      title: '15. Aduan privasi',
      blocks: [
        { p: 'Hantar aduan ke {privacyEmail} (atau gunakan "Permintaan data anda" dalam Akaun saya dan pilih "Aduan"). Kami akan mengakui penerimaan, menyiasat dan membalas secara bertulis. Jika anda masih tidak berpuas hati, anda boleh menghubungi Pesuruhjaya Perlindungan Data Peribadi Malaysia (Jabatan Perlindungan Data Peribadi).' },
      ],
    },
    {
      id: 'changes',
      title: '16. Perubahan pada notis ini',
      blocks: [
        { p: 'Kami akan menyiarkan notis yang dikemas kini dengan tarikh "dikemas kini" baharu. Bagi perubahan ketara kami akan memberitahu pengguna yang log masuk sebelum ia berkuat kuasa dan, jika undang-undang atau perubahan itu memerlukannya, meminta penerimaan semula. Versi yang anda terima direkod pada akaun anda.' },
      ],
    },
  ],
};
