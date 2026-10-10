export const displayText = {
  en: {
    titleLead: 'Live', titleRest: 'Voting Results', scanLead: 'Scan the QR code to', scanAccent: 'cast your vote',
    title: 'Live Voting Results', subtitle: 'See the most voted makers in each category', votes: 'Votes',
    final: 'Final', live: 'Live', updating: 'Updating', disconnected: 'Disconnected', closed: 'Closed',
    lost: 'Connection lost. Showing the last received results.', polling: 'Updating results by polling.',
    join: 'Be part of The Maker Collective 2026', scan: 'Scan the QR code to cast your vote', qrAlt: 'QR code to vote',
    qrUnavailable: 'Voting QR is temporarily unavailable. Retrying…', ended: 'Voting has ended', votingClosed: 'Voting is closed',
    waiting: 'Waiting for the first vote…', standings: 'standings', more: 'more makers',
    expired: 'Display access expired or the key was rotated. Open a current display link.',
    connectError: 'Cannot connect to live results. Retrying…', retry: 'Retry now',
    protected: 'This screen is protected. Open the display link from the admin console, or enter the display key.',
    key: 'Display key', unlocking: 'Unlocking…', unlock: 'Unlock',
  },
  ar: {
    titleLead: 'نتائج', titleRest: 'التصويت المباشرة', scanLead: 'امسح رمز QR', scanAccent: 'للإدلاء بصوتك',
    title: 'نتائج التصويت المباشرة', subtitle: 'تابع الصُنّاع الأكثر حصولاً على الأصوات في كل فئة', votes: 'أصوات',
    final: 'النتائج النهائية', live: 'مباشر', updating: 'جارٍ التحديث', disconnected: 'غير متصل', closed: 'مغلق',
    lost: 'انقطع الاتصال. نعرض آخر النتائج المستلمة.', polling: 'جارٍ تحديث النتائج دورياً.',
    join: 'كن جزءاً من ملتقى الصُنّاع ٢٠٢٦', scan: 'امسح رمز QR للإدلاء بصوتك', qrAlt: 'رمز QR للتصويت',
    qrUnavailable: 'رمز التصويت غير متاح مؤقتاً. نحاول مجدداً…', ended: 'انتهى التصويت', votingClosed: 'التصويت مغلق',
    waiting: 'بانتظار أول صوت…', standings: 'الترتيب', more: 'صُنّاع آخرون',
    expired: 'انتهت صلاحية الوصول أو تغيّر مفتاح العرض. افتح رابط العرض الحالي.',
    connectError: 'تعذّر الاتصال بالنتائج المباشرة. نحاول مجدداً…', retry: 'حاول مجدداً',
    protected: 'هذه الشاشة محمية. افتح رابط العرض من لوحة الإدارة أو أدخل مفتاح العرض.',
    key: 'مفتاح العرض', unlocking: 'جارٍ فتح الشاشة…', unlock: 'فتح الشاشة',
  },
};
export type DisplayText = typeof displayText.en;
