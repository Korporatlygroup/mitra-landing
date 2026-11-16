import type { LegalDocument } from '@/lib/legal';

export const governmentDisclaimer: LegalDocument = {
  title: 'Notis Bantuan Kerajaan',
  intro:
    'Pemandu Bantuan Kerajaan membantu perniagaan kecil mencari program awam. Ia ialah panduan, bukan permohonan, kelulusan atau keputusan rasmi. Ini ialah draf untuk semakan pengurusan dan belum berkuat kuasa.',
  sections: [
    {
      id: 'independent',
      title: '1. INOK bersikap bebas',
      blocks: [
        { p: 'INOK bukan agensi kerajaan dan tidak secara automatik bergabung dengan, disokong oleh atau bertindak bagi mana-mana kementerian, agensi atau program yang ditunjukkan di halaman ini. Nama agensi dan program digunakan hanya untuk menyatakan apa ia. Logo atau jata agensi tidak ditunjukkan melainkan agensi telah memberi kebenaran bertulis.' },
      ],
    },
    {
      id: 'sources',
      title: '2. Dari mana maklumat datang',
      blocks: [
        { p: 'Maklumat program diambil daripada sumber rasmi yang dipautkan pada setiap halaman program. Kakitangan INOK menyemak setiap rekod berbanding sumber rasminya sebelum diterbitkan. Rekod yang belum disahkan tidak diterbitkan sebagai aktif.' },
      ],
    },
    {
      id: 'changes',
      title: '3. Syarat berubah',
      blocks: [
        { p: 'Syarat kelayakan, jumlah, tarikh dan dokumen boleh berubah tanpa notis. Setiap halaman program menunjukkan tarikh kami terakhir mengesahkannya. Tarikh permohonan dan ketersediaan mesti disemak dengan agensi sebelum anda bergantung kepadanya. Apabila kami tidak dapat mengesahkan program masih dibuka, kami menunjukkan statusnya sebagai tidak diketahui.' },
      ],
    },
    {
      id: 'matching',
      title: '4. Keputusan pemadanan ialah panduan awal',
      blocks: [
        { p: 'Pencari membandingkan apa yang anda nyatakan dengan kriteria program yang diterbitkan. Padanan, atau kedudukan tinggi, bukan keputusan tentang kelayakan anda dan tidak bermakna anda akan layak, diluluskan atau menerima pembiayaan. Tidak sepadan juga bukan penolakan.' },
      ],
    },
    {
      id: 'apply',
      title: '5. Mohon hanya melalui saluran rasmi',
      blocks: [
        { p: 'Permohonan dihantar kepada agensi yang bertanggungjawab melalui saluran rasminya, menggunakan pautan rasmi pada halaman program. Agensi membuat keputusan akhir. INOK tidak meluluskan geran, tidak mengeluarkan pembiayaan kerajaan, dan tidak bertindak bagi pihak anda dengan agensi.' },
        { p: 'INOK tidak mengenakan sebarang yuran permohonan rasmi kerajaan bagi pihak agensi dan tidak meminta anda membayar untuk dipertimbangkan bagi program kerajaan, melainkan perkhidmatan khusus diterangkan dan dibenarkan secara bertulis. Berhati-hati terhadap sesiapa yang meminta wang untuk "menjamin" kelulusan.' },
      ],
    },
    {
      id: 'each-programme',
      title: '6. Apa yang ditunjukkan setiap halaman program',
      blocks: [
        {
          ul: [
            'agensi yang bertanggungjawab dan nama program;',
            'jenis bantuan dan penerima yang dimaksudkan;',
            'sumber rasmi dan tarikh terakhir disahkan;',
            'tarikh tutup permohonan, atau bahawa ia tidak diketahui;',
            'syarat, seperti diterbitkan agensi;',
            'pautan permohonan rasmi;',
            'notis ini: INOK tidak bergabung dengan agensi dan tidak menentukan kelayakan.',
          ],
        },
      ],
    },
    {
      id: 'corrections',
      title: '7. Pembetulan dan laporan',
      blocks: [
        { p: 'Kami membetulkan atau membuang maklumat yang lapuk. Jika anda melihat kesilapan, sila tulis ke {supportEmail} dengan nama program dan sumber rasmi yang betul. Program tersimpan, nota dan penjejakan adalah persendirian kepada organisasi anda.' },
      ],
    },
  ],
};
