/* Visitor-page strings (English / Arabic). */
export type Lang = 'en' | 'ar';

export const T = {
  en: {
    otpNeedNewCode: 'No signed-in session was found. Request a new code below to continue.',
    otpRecoveryUnavailable: 'We could not check whether verification completed. Check your connection, then check your session before requesting another code.',
    checkSession: 'Check my session', requestNewCode: 'Request a new code',
    loginTitle: 'Pick your', loginTitleAccent: 'favourite makers',
    qrTitle: 'Scan the venue QR code',
    awards: 'Community Awards', switchTo: 'عربي',
    heroKicker: 'The Maker Collective 2026', heroTitle: 'Pick your favourite makers',
    heroBody: (n: number) => `${n} awards · one vote each · takes under a minute.`,
    name: 'First and last name', namePh: 'e.g. Sara Ahmad', number: 'Your number',
    fullNameError: 'Enter your first and last name.', duplicateNameError: 'This name is already registered. Please use your own full name.', phoneAttachedError: 'This number is already attached to another user.',
    phoneInvalidError: 'Enter a valid mobile number, such as 07X XXX XXXX or +9627XXXXXXXX.',
    phone: 'Mobile number', phonePh: '07X XXX XXXX', phoneHint: 'We’ll text you a 6-digit code. One phone = one set of votes.',
    consent: 'Keep me posted about future Makerspace events.',
    sendCode: 'Log In', sending: 'Sending…',
    privacy: 'Your name and number are stored securely and only seen by the Makerspace team.',
    qrRequired: 'Scan the current voting QR code on the venue screen to continue. It changes every 20 seconds.',
    qrExpired: 'That QR code expired. Scan the current code on the venue screen.',
    otpTitle: 'Enter your code', otpBody: (p: string) => `We sent a 6-digit code to ${p}.`,
    verify: 'Verify', verifying: 'Checking…', resend: 'Resend code', resendIn: (s: number) => `Resend in ${s}s`, changeNumber: 'Change number',
    demoCode: (c: string) => `Demo mode — your code is ${c}`,
    hi: (n: string) => `Hi ${n}`, progress: (a: number, b: number) => `${a} of ${b} votes cast`,
    search: 'Search makers or projects', noMatch: 'No makers match your search.',
    noCategoriesTitle: 'No awards are set up yet', noCategoriesBody: 'Ask the event team to add categories and makers in the admin console, then try again.',
    vote: 'Vote', yourPick: 'Your vote', booth: 'Booth',
    votedBanner: (p: string) => `You voted for ${p}`, votedNote: 'Votes are final — thank you!',
    confirmTitle: 'Confirm your vote', confirmBody: (c: string) => `for ${c}`, confirmNote: 'You can’t change this vote later.',
    confirm: 'Confirm vote', cancel: 'Cancel', casting: 'Voting…',
    recorded: 'Vote recorded ✓', next: 'Next category',
    doneTitle: 'You’re all set!', doneBody: 'Your votes are in. Watch the live results on the big screen.', backToLogin: 'Back to login',
    closedTitle: 'Voting is closed', endedTitle: 'Voting has ended', notStarted: 'Voting hasn’t opened yet', closedBody: 'Check back during the event — the Makerspace team will open voting shortly.',
    endedBody: 'Please wait while we prepare the final results. They will be announced shortly.',
    offTitle: 'Voting is for visitors at the venue', offBody: 'Connect to the event Wi-Fi, or let us check your location to confirm you’re here.',
    useLocation: 'Use my location', locating: 'Checking location…', locDenied: 'Location permission was denied. Enable it in your browser settings, or connect to the event Wi-Fi.',
    locOutside: 'It looks like you’re not at the venue. Connect to the event Wi-Fi and try again.', retry: 'Try again',
    offline: 'You’re offline — we’ll retry when you’re back.', signOut: 'Not you?',
    catDone: 'Done',
    errOtpInvalid: 'This code is no longer valid. Please request a new one.', errOtpExpired: 'This code has expired. Please request a new one.',
    errOtpLocked: 'Too many wrong attempts. Please request a new code.', errOtpWrong: 'Incorrect code. Please try again.',
    errOtpWrongLeft: (n: number) => `Incorrect code. ${n} attempt${n === 1 ? '' : 's'} left.`,
    errCooldown: (s: number) => `Please wait ${s}s before requesting another code.`,
    errRate: 'Too many attempts. Please wait a moment and try again.', errSms: 'We could not send the SMS right now. Please try again in a moment.',
    errNotVerified: 'Please verify your phone number first.', errBadVote: 'That maker is not in this category.',
    errAlreadyVoted: 'You have already voted in this category.', errNotOnSite: 'Voting is only available to visitors at the venue. Connect to the event Wi-Fi or allow location access.',
    errNotStarted: 'Voting hasn’t opened yet.', errClosed: 'Voting is closed right now.',
    errOffline: 'You appear to be offline. Check your connection and try again.', errNetwork: 'Connection problem. Please try again.',
    errUnconfirmed: 'Could not confirm whether the action completed. Refresh to check its status before trying again.',
    errGeneric: 'Something went wrong. Please try again.', locUnavailable: 'We couldn’t get your location. Please try again.',
    brandHome: 'MC2026 Awards home', brandAlt: 'The Maker Collective 2026', brandAltFull: 'The Maker Collective 2026 — organized by Crown Prince Foundation',
  },
  ar: {
    otpNeedNewCode: 'لم نعثر على جلسة تسجيل دخول. اطلب رمزاً جديداً أدناه للمتابعة.',
    otpRecoveryUnavailable: 'تعذّر التحقق مما إذا اكتمل تسجيل الدخول. تحقق من اتصالك ثم تحقق من جلستك قبل طلب رمز آخر.',
    checkSession: 'تحقق من جلستي', requestNewCode: 'اطلب رمزاً جديداً',
    loginTitle: 'اختر', loginTitleAccent: 'صُنّاعك المفضّلين',
    qrTitle: 'امسح رمز QR في مكان الفعالية',
    awards: 'جوائز المجتمع', switchTo: 'English',
    heroKicker: 'ملتقى الصناع 2026', heroTitle: 'اختر صُنّاعك المفضّلين',
    heroBody: (n: number) => `${n} جوائز · صوت واحد لكل جائزة · أقل من دقيقة.`,
    name: 'الاسم الأول واسم العائلة', namePh: 'مثال: سارة أحمد', number: 'رقمك',
    fullNameError: 'يرجى إدخال الاسم الأول واسم العائلة.', duplicateNameError: 'هذا الاسم مسجل بالفعل. يرجى إدخال اسمك الكامل.', phoneAttachedError: 'هذا الرقم مرتبط بالفعل بمستخدم آخر.',
    phoneInvalidError: 'يرجى إدخال رقم هاتف محمول صحيح، مثل 07X XXX XXXX أو +9627XXXXXXXX.',
    phone: 'رقم الهاتف', phonePh: '07X XXX XXXX', phoneHint: 'سنرسل لك رمزًا من ٦ أرقام. كل هاتف = مجموعة أصوات واحدة.',
    consent: 'أرغب بمعرفة فعاليات الميكرسبيس القادمة.',
    qrRequired: 'امسح رمز التصويت الحالي على شاشة الفعالية للمتابعة. يتغيّر الرمز كل 20 ثانية.',
    qrExpired: 'انتهت صلاحية رمز QR هذا. امسح الرمز الحالي على شاشة الفعالية.',
    sendCode: 'تسجيل الدخول', sending: 'جارٍ الإرسال…',
    privacy: 'يتم حفظ اسمك ورقمك بشكل آمن ولا يطّلع عليهما إلا فريق الميكرسبيس.',
    otpTitle: 'أدخل الرمز', otpBody: (p: string) => `أرسلنا رمزًا من ٦ أرقام إلى ${p}.`,
    verify: 'تحقّق', verifying: 'جارٍ التحقق…', resend: 'إعادة إرسال الرمز', resendIn: (s: number) => `إعادة الإرسال بعد ${s} ث`, changeNumber: 'تغيير الرقم',
    demoCode: (c: string) => `وضع العرض — الرمز هو ${c}`,
    hi: (n: string) => `أهلًا ${n}`, progress: (a: number, b: number) => `${a} من ${b} أصوات`,
    search: 'ابحث عن صانع أو مشروع', noMatch: 'لا توجد نتائج مطابقة.',
    noCategoriesTitle: 'لم يتم إعداد الجوائز بعد', noCategoriesBody: 'اطلب من فريق الفعالية إضافة الفئات والصنّاع من لوحة الإدارة، ثم حاول مرة أخرى.',
    vote: 'صوّت', yourPick: 'صوتك', booth: 'جناح',
    votedBanner: (p: string) => `صوّتَّ لـ ${p}`, votedNote: 'الأصوات نهائية — شكرًا لك!',
    confirmTitle: 'تأكيد التصويت', confirmBody: (c: string) => `في فئة ${c}`, confirmNote: 'لا يمكن تغيير هذا الصوت لاحقًا.',
    confirm: 'أكّد التصويت', cancel: 'إلغاء', casting: 'جارٍ التصويت…',
    recorded: 'تم تسجيل صوتك ✓', next: 'الفئة التالية',
    doneTitle: 'تم بنجاح!', doneBody: 'تم تسجيل أصواتك. تابع النتائج المباشرة على الشاشة الكبيرة.', backToLogin: 'العودة لتسجيل الدخول',
    closedTitle: 'التصويت مغلق', endedTitle: 'انتهى التصويت', notStarted: 'لم يبدأ التصويت بعد', closedBody: 'عُد خلال الفعالية — سيفتح فريق الميكرسبيس التصويت قريبًا.',
    endedBody: 'يرجى الانتظار ريثما نُجهّز النتائج النهائية. سيتم إعلانها قريبًا.',
    offTitle: 'التصويت متاح لزوّار المكان فقط', offBody: 'اتصل بشبكة الواي فاي الخاصة بالفعالية، أو اسمح لنا بالتحقق من موقعك.',
    useLocation: 'استخدم موقعي', locating: 'جارٍ التحقق من الموقع…', locDenied: 'تم رفض إذن الموقع. فعّله من إعدادات المتصفح أو اتصل بشبكة الفعالية.',
    locOutside: 'يبدو أنك لست في مكان الفعالية. اتصل بشبكة الواي فاي وحاول مجددًا.', retry: 'حاول مجددًا',
    offline: 'أنت غير متصل — سنحاول مجددًا عند عودة الاتصال.', signOut: 'لست أنت؟',
    catDone: 'تم',
    errOtpInvalid: 'هذا الرمز لم يعد صالحًا. يرجى طلب رمز جديد.', errOtpExpired: 'انتهت صلاحية هذا الرمز. يرجى طلب رمز جديد.',
    errOtpLocked: 'محاولات خاطئة كثيرة. يرجى طلب رمز جديد.', errOtpWrong: 'الرمز غير صحيح. حاول مرة أخرى.',
    errOtpWrongLeft: (n: number) => `الرمز غير صحيح. تبقّى ${n} محاولة.`,
    errCooldown: (s: number) => `يرجى الانتظار ${s} ث قبل طلب رمز آخر.`,
    errRate: 'محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة مجددًا.', errSms: 'تعذّر إرسال الرسالة النصية حاليًا. يرجى المحاولة بعد قليل.',
    errNotVerified: 'يرجى التحقق من رقم هاتفك أولًا.', errBadVote: 'هذا الصانع ليس ضمن هذه الفئة.',
    errAlreadyVoted: 'لقد صوّتَّ في هذه الفئة من قبل.', errNotOnSite: 'التصويت متاح لزوّار المكان فقط. اتصل بشبكة الواي فاي الخاصة بالفعالية أو اسمح بالوصول إلى الموقع.',
    errNotStarted: 'لم يبدأ التصويت بعد.', errClosed: 'التصويت مغلق حاليًا.',
    errOffline: 'يبدو أنك غير متصل. تحقق من اتصالك وحاول مجددًا.', errNetwork: 'مشكلة في الاتصال. يرجى المحاولة مجددًا.',
    errUnconfirmed: 'تعذّر التأكد من اكتمال العملية. حدّث الصفحة للتحقق قبل المحاولة مرة أخرى.',
    errGeneric: 'حدث خطأ ما. يرجى المحاولة مجددًا.', locUnavailable: 'تعذّر تحديد موقعك. يرجى المحاولة مجددًا.',
    brandHome: 'الصفحة الرئيسية لجوائز MC2026', brandAlt: 'ملتقى الصناع 2026', brandAltFull: 'ملتقى الصناع 2026 — بتنظيم مؤسسة ولي العهد',
  },
};

export type Dict = typeof T.en;
export type Key = keyof Dict;

export function makeT(lang: Lang) {
  return (k: Key, ...args: any[]): string => {
    const v = (T[lang] as any)[k];
    return typeof v === 'function' ? v(...args) : v;
  };
}

type ErrLike = { code?: string; message?: string; body?: Record<string, any> } | null | undefined;

/** Visitor-facing text for an API error, in the page language (server messages are English-only). */
export function errorText(t: ReturnType<typeof makeT>, e: ErrLike): string {
  const body = e?.body || {};
  switch (e?.code) {
    case 'otp_invalid': return t('errOtpInvalid');
    case 'otp_expired': return t('errOtpExpired');
    case 'otp_locked': return t('errOtpLocked');
    case 'otp_wrong': {
      const left = /(\d+) attempt/.exec(e.message || '');
      return left ? t('errOtpWrongLeft', Number(left[1])) : t('errOtpWrong');
    }
    case 'otp_cooldown': return t('errCooldown', Number(body.retryAfter) || 0);
    case 'rate_limited': return t('errRate');
    case 'sms_failed': return t('errSms');
    case 'not_verified': return t('errNotVerified');
    case 'bad_vote': return t('errBadVote');
    case 'already_voted': return t('errAlreadyVoted');
    case 'not_on_site': return t('errNotOnSite');
    case 'vote_qr_expired': return t('qrExpired');
    case 'bad_name': return t('fullNameError');
    case 'duplicate_name': return t('duplicateNameError');
    case 'phone_attached': return t('phoneAttachedError');
    case 'bad_phone': return t('phoneInvalidError');
    case 'voting_closed': return body.voting?.reason === 'not_started' ? t('errNotStarted') : t('errClosed');
    case 'offline': return t('errOffline');
    case 'network': return t('errNetwork');
    case 'network_unconfirmed': return t('errUnconfirmed');
    default: return t('errGeneric');
  }
}
