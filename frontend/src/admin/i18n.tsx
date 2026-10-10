import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ApiError } from '../lib/api';
import { safeStore } from '../lib/util';

/* Admin console strings (English / Arabic). Arabic must have every English key. */
export type Lang = 'en' | 'ar';

const en = {
  dir: 'ltr' as 'ltr' | 'rtl',
  switchTo: 'عربي',
  switchLabel: 'التبديل إلى العربية',
  when: (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'),

  common: {
    cancel: 'Cancel', save: 'Save', saving: 'Saving…', close: 'Close', edit: 'Edit', delete: 'Delete', deleting: 'Deleting…',
    retry: 'Retry', refresh: 'Refresh', refreshing: 'Refreshing…', loading: 'Loading…', confirm: 'Confirm',
    areYouSure: 'Are you sure?', typeToConfirm: (w: string) => `Type ${w}`, yes: 'Yes', no: 'No', you: 'you',
    copied: (what: string) => `${what} copied`, copyFailed: 'Could not copy. Please copy it manually.',
    prev: 'Previous', next: 'Next', of: (a: number, b: number, total: number) => `${a}–${b} of ${total}`,
  },

  errors: {
    generic: 'Something went wrong. Please try again.',
    network: 'Connection problem. Please try again.',
    offline: 'You appear to be offline. Check your connection and try again.',
    network_unconfirmed: 'Could not confirm whether the action completed. Refresh to check before trying again.',
  } as Record<string, string>,

  shell: {
    brand: 'MC2026 Awards', console: 'Admin console', logoAlt: 'The Maker Collective 2026',
    nav: { dashboard: 'Dashboard', exhibitors: 'Exhibitors', categories: 'Categories', results: 'Results', visitors: 'Visitors', settings: 'Settings' } as Record<string, string>,
    administrator: 'Administrator', viewer: 'Viewer (read-only)', signOut: 'Sign out', signingOut: 'Signing out…',
    mfaTip: 'Tip: turn on two-factor sign-in in Settings › Account & team.',
    sessionExpired: 'Your session has expired. Please sign in again.',
  },

  login: {
    console: 'Admin console', signIn: 'Sign in', twoFactor: 'Two-factor check', username: 'Username', password: 'Password',
    signingIn: 'Signing in…', retryIn: (c: string) => `Retry in ${c}`, codeHelp: 'Enter the 6-digit code from your authenticator app.',
    code: 'Authenticator code', verify: 'Verify', verifying: 'Verifying…', back: 'Back',
    showPassword: 'Show password', hidePassword: 'Hide password',
  },

  dash: {
    title: 'Dashboard',
    open: 'Voting is open', openUntil: (t: string) => `Closes automatically at ${t}.`, openNow: 'Verified visitors on site can vote now.',
    opensAt: (t: string) => `Voting opens at ${t}`, waiting: 'Voting is switched on and will start on schedule.',
    ended: 'Voting has ended', endedAt: (t: string) => `Voting ended at ${t}.`,
    closed: 'Voting is closed', closedNow: 'Visitors cannot vote right now.',
    openBtn: 'Open voting', closeBtn: 'Pause voting', updating: 'Updating…',
    endBtn: 'End voting', confirmEnd: 'End voting now? Visitors will see that voting has ended and should wait for the results.', endedToast: 'Voting ended. Visitors are now waiting for results.',
    continueBtn: 'Reopen with current votes', restartBtn: 'Clear votes and start over', confirmRestart: 'This permanently clears all votes and immediately reopens voting. Registered visitors will stay registered. Type RESET to continue.', restartDone: (n: number) => `Voting restarted. Cleared ${n} votes.`,
    openNowBtn: 'Open now', reopenBtn: 'Reopen voting', switchOff: 'Switch off',
    openedNow: 'Voting is open. The schedule times that were holding it back were cleared.',
    confirmClose: 'Pause voting now? Visitors will not be able to vote until you reopen it.',
    opened: 'Voting opened', closedToast: 'Voting paused',
    schedule: 'Schedule', scheduleSub: 'Optional · Amman time', opens: 'Opens', closes: 'Closes', clear: 'Clear',
    scheduleHint: 'While voting is open, votes are only accepted between these times. Leave both empty to open and close voting by hand.',
    scheduleSaved: 'Schedule saved', scheduleCleared: 'Schedule cleared',
    showWinners: 'Show winners on screen', hideWinners: 'Hide winners', winnersShown: 'Winners are now shown on the results screen', winnersHidden: 'Winners hidden from the results screen',
    winnersHint: 'When voting is over, announce the winners on the results screen.', winnersOn: 'The results screen is showing the final winners.',
    protection: 'On-site protection', protectionOff: 'Off. Anyone, anywhere can vote.', change: 'Change', fixNow: 'Fix now',
    statsDown: 'Statistics are not updating.', statsLast: 'Showing the last values.', retrying: 'Retrying automatically.',
    votes: 'Votes cast', verified: 'Verified visitors', recent: 'Votes in the last 5 min', onBallot: 'Exhibitors on the ballot', blocked: 'Off-site attempts blocked',
    leading: 'Leading now', live: 'Live', polling: 'Updating every 5 s', reconnecting: 'Reconnecting…', connecting: 'Connecting…',
    showingFrom: (t: string) => `Showing results from ${t}.`, loadingStandings: 'Loading standings…',
    votesCount: (n: string) => `${n} votes`, noVotes: 'No votes yet', allResults: 'All results and export',
    share: 'Share', votePage: 'Voting page', voteLink: 'Voting link', openPage: 'Open page', openPageHint: 'Opens the voting page on this computer. As a signed-in admin you can log in and vote to test it, without scanning the QR.',
    localWarn: 'Phones cannot open localhost. Open the admin page through the event’s LAN address; voting links will follow it automatically.',
    screen: 'Results screen (TV)', screenNote: 'Private link. Anyone who has it can see the live results.',
    copyLink: 'Copy link', copyKey: 'Copy key only', regenKey: 'Regenerate key', regenerating: 'Regenerating…', keyRegenerated: 'New screen key created. Old links and unlocked screens no longer work.',
    confirmRegen: 'Create a new screen key? The old key and every screen link already shared will stop working, and screens that were unlocked with it will ask for the new key.', screenKey: 'Screen key', openScreen: 'Open screen', screenLink: 'Screen link',
  },

  modes: {
    ip_or_geo: ['Venue Wi-Fi or location', 'Recommended. People on the venue Wi-Fi pass straight away; people on mobile data share their location.'],
    ip: ['Venue Wi-Fi only', 'Strictest. Only the venue network can vote.'],
    geo: ['Location only', 'The phone must be inside the venue radius.'],
    ip_and_geo: ['Wi-Fi and location', 'Both checks must pass.'],
    off: ['Off', 'Anyone, anywhere can vote. Testing only.'],
  } as Record<string, [string, string]>,
  summary: {
    networks: (n: number) => `${n} network${n === 1 ? '' : 's'}`, noNetwork: 'no network set',
    radius: (m: number) => `${m} m radius`, noLocation: 'no location set',
  },

  settings: {
    title: 'Settings',
    tabs: { access: 'On-site access', event: 'Event & screen', account: 'Account', activity: 'Activity log' } as Record<string, string>,
  },

  access: {
    who: 'Who can vote',
    intro: 'Only people at the venue can vote. At each new venue, connect through its Wi-Fi, use the detected network and your location, then save.',
    rule: 'Rule', offWarning: 'With the rule off, people outside the venue can vote. Use this for testing only.',
    network: 'Venue network', thisNetwork: 'This computer’s network', allowed: 'Allowed', useNetwork: 'Use this network',
    networks: 'Allowed networks', networksPh: 'One per line, e.g. 37.220.1.0/24',
    networkHint: 'When opened through the event LAN gateway, the detected Wi-Fi network is added automatically. Otherwise, ask venue IT for the network range.',
    unused: 'Not used by the selected rule.',
    location: 'Venue location', useLocation: 'Use my location', locating: 'Locating…', viewMap: 'View on map',
    lat: 'Latitude', lng: 'Longitude', radius: 'Radius (m)', accuracy: 'Max GPS error (m)',
    radiusHint: 'The radius should cover the whole venue. 150 m suits most halls.',
    locationSet: (m: number) => `Location captured (accurate to ${m} m). Save to apply.`,
    locationFailed: 'Could not read your location. Allow location access in the browser and try again.',
    unsaved: 'You have unsaved changes.', allSaved: 'All changes saved.', saveRules: 'Save rules', saved: 'Rules saved. They apply immediately.',
  },

  event: {
    details: 'Event details', detailsIntro: 'Shown on the voting page and on the results screen.',
    name: 'Awards name', tagline: 'Tagline', venue: 'Venue', save: 'Save details', saved: 'Event details saved',
    address: 'Voting page address', addressHint: 'The QR code opens this address on visitors’ phones. Leave empty to use the same address you used to open the admin page.',
    addressLocal: 'Phones cannot open localhost. Open the admin page through the event’s LAN address, or set an optional public address.',
    screen: 'Results screen', screenIntro: 'What the public TV shows during the event.',
    withCounts: 'Rankings and vote counts', rankingsOnly: 'Rankings only', showsLabel: 'Results screen shows',
    countsOn: 'The screen now shows vote counts', countsOff: 'The screen now shows rankings only',
    countsHint: 'Hiding the counts keeps the final numbers a surprise until the award ceremony.',
  },

  security: {
    mfa: 'Two-factor authentication', enabled: 'Enabled', notEnabled: 'Not enabled',
    mfaOn: 'Sign-in requires your password and a code from your authenticator app.',
    disable: 'Disable two-factor', disableBtn: 'Disable', disabling: 'Disabling…', disabled: 'Two-factor disabled',
    currentPassword: 'Current password', code: 'Authenticator code', codePh: '6-digit code', codeTitle: 'Enter exactly 6 digits',
    setupTitle: 'Set up two-factor', step1: '1. Scan this QR code with your authenticator app.',
    manualKey: 'Or enter this key manually:', step2: '2. Enter the 6-digit code it shows:', qrAlt: 'Authenticator QR code',
    turnOn: 'Turn on two-factor', enabling: 'Enabling…', enabledToast: 'Two-factor enabled',
    mfaIntro: 'Protect the admin console with a time-based code (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).',
    setup: 'Set up two-factor', settingUp: 'Setting up…',
    password: 'Change password', passwordIntro: 'Changing your password signs out every other session.',
    newPassword: 'New password (10+ chars)', update: 'Update password', updating: 'Updating…', changed: 'Password changed',
    team: 'Team accounts', cols: ['User', 'Role', 'Last sign-in', ''], on: 'On', off: 'Off',
    roles: { admin: 'Administrator', viewer: 'Viewer (read-only)' } as Record<string, string>,
    loadingTeam: 'Loading team accounts…', teamError: (e: string) => `Could not load team accounts: ${e}. Use Retry to try again.`,
    noTeam: 'No team accounts found.', remove: 'Remove', removing: 'Removing…', confirmRemove: (u: string) => `Remove ${u}?`,
    removed: 'User removed', usernamePh: 'username', usernameTitle: '3–32 letters, digits, dots, underscores or hyphens',
    tempPassword: 'temporary password (10+)', add: 'Add user', adding: 'Adding…', added: 'User added',
  },

  audit: {
    intro: 'The last 100 sign-ins, changes and exports, newest first.',
    cols: ['When', 'Who', 'Action', 'IP'], empty: 'No activity yet.', details: 'View details',
    loadError: (e: string) => `Could not refresh the activity log: ${e}`, showingOld: ' Showing previously loaded entries.',
    actions: {} as Record<string, string>,
  },

  cat: {
    title: 'Award categories',
    manage: 'Exhibitors', membersTitle: (n: string) => `Exhibitors in “${n}”`, membersHint: 'Tick an exhibitor to add them to this category; untick to remove them. Changes save immediately.',
    noExhibitors: 'No exhibitors yet.', membersSaved: 'Category updated', checkAll: 'Check all', clearAll: 'Clear all',
    bulkSkipped: (n: number) => `${n} exhibitor(s) could not be changed (a visible exhibitor must keep at least one category).`,
    add: '+ Add category', noDescription: 'No description', exhibitors: (n: number) => `${n} exhibitors`, hidden: 'Hidden',
    confirmDelete: (n: string) => `Delete category “${n}”?`,
    confirmForce: (n: string) => `This category already has votes. Permanently delete “${n}” and discard all its votes? This also removes its exhibitor assignments and may leave active exhibitors without a category. This cannot be undone.`,
    forceBtn: 'Delete and discard votes', deleted: 'Category deleted', saved: 'Category saved',
    addTitle: 'Add category', editTitle: 'Edit category', name: 'Name', slug: 'Slug (optional)', slugPh: 'e.g. community-choice',
    slugHint: 'Leave blank to generate from the name. Slugs must be unique; spaces and punctuation are converted to hyphens when saved.',
    description: 'Description (shown to visitors)', active: 'Active',
  },

  ex: {
    title: 'Exhibitors', sub: (n: number) => `${n} exhibitors · photos, descriptions and category assignments`,
    add: '+ Add exhibitor', search: 'Search exhibitors…', cols: ['', 'Project / maker', 'Booth', 'Categories', 'Votes', 'Status', ''],
    noMatch: 'No matches.', empty: 'No exhibitors yet. Add the first one.', visible: 'Visible', hidden: 'Hidden',
    confirmDelete: (n: string) => `Delete “${n}”?`,
    confirmForce: 'This exhibitor already has votes. Delete it anyway and discard those votes? You can hide it instead by unticking “Visible”.',
    forceBtn: 'Delete and discard votes', deleted: 'Exhibitor deleted', addedToast: 'Exhibitor added', savedToast: 'Exhibitor saved',
    confirmSaveForce: 'Removing this exhibitor from a category discards its votes there. Continue?', saveForceBtn: 'Discard votes & save',
    addTitle: 'Add exhibitor', editTitle: 'Edit exhibitor',
    required: 'Visible exhibitors need a photo, a short description, and at least one category.',
    missing: (list: string[]) => `Please provide ${list.join(', ')}.`,
    missName: 'a maker/team name', missPhoto: 'a photo (upload one or untick Visible)', missDescription: 'a short description', missCategory: 'at least one category',
    noPhoto: 'No photo', photo: 'Photo / visual', photoBad: 'Photo must be a JPEG, PNG or WebP image under 3 MB.',
    photoHint: 'JPEG, PNG or WebP · max 3 MB · landscape 4:3 looks best', removePhoto: 'Remove photo',
    replacePhoto: 'Upload a replacement photo or untick “Visible on the voting page” before saving.',
    project: 'Project name', projectPh: 'e.g. SolarSip', maker: 'Maker / team', makerPh: 'Person or team name',
    booth: 'Booth', boothPh: 'e.g. B4', visibleCheck: 'Visible on the voting page',
    description: 'Short description', descriptionPh: 'One or two sentences visitors will see',
    competes: 'Competes in', competesReq: ' (select at least one)',
    noCategories: 'Create a category first, or untick Visible to save this exhibitor as hidden.',
    saveNew: 'Add exhibitor', saveEdit: 'Save changes',
  },

  results: {
    title: 'Results', sub: (v: string, p: string, t: string) => `${v} votes from ${p} verified visitors · updated ${t}`,
    csv: 'Export CSV', json: 'Export JSON', reset: 'Reset results…', votes: (n: string) => `${n} votes`,
    resetTitle: 'Reset results',
    resetBody: 'This closes voting and permanently deletes every vote. Voting stays closed until you reopen it. A snapshot of the current counts is kept in the activity log. Export first if you need the data.',
    purge: 'Also delete all visitor registrations (names & phone numbers)', confirmReset: 'I understand that this permanently deletes all votes and closes voting.', adminPassword: 'Admin password',
    deleteAll: 'Delete all votes', resetDone: (n: number) => `Voting closed. Deleted ${n} votes.`,
  },

  visitors: {
    title: 'Visitors', sub: 'Exports include verified visitors and full phone numbers, and are recorded in the activity log. The first export includes only people who agreed to future event updates; Export all includes everyone, including those who did not agree.',
    exportOptIn: 'Export update-consenting visitors', exportAll: 'Export all verified visitors',
    cols: ['Name', 'Phone', 'Verified', 'Votes', 'Outreach opt-in'], empty: 'No verified visitors yet.',
  },

  notFound: 'This page does not exist.',
};

type Dict = typeof en;

const ar: Dict = {
  dir: 'rtl',
  switchTo: 'English',
  switchLabel: 'Switch to English',
  when: (iso) => (iso ? new Date(iso).toLocaleString('ar-JO-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—'),

  common: {
    cancel: 'إلغاء', save: 'حفظ', saving: 'جارٍ الحفظ…', close: 'إغلاق', edit: 'تعديل', delete: 'حذف', deleting: 'جارٍ الحذف…',
    retry: 'إعادة المحاولة', refresh: 'تحديث', refreshing: 'جارٍ التحديث…', loading: 'جارٍ التحميل…', confirm: 'تأكيد',
    areYouSure: 'هل أنت متأكد؟', typeToConfirm: (w) => `اكتب ${w}`, yes: 'نعم', no: 'لا', you: 'أنت',
    copied: (what) => `تم نسخ ${what}`, copyFailed: 'تعذّر النسخ. يرجى نسخه يدويًا.',
    prev: 'السابق', next: 'التالي', of: (a, b, total) => `${a}–${b} من ${total}`,
  },

  errors: {
    generic: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    network: 'مشكلة في الاتصال. يرجى المحاولة مرة أخرى.',
    offline: 'يبدو أنك غير متصل بالإنترنت. تحقّق من الاتصال وحاول مرة أخرى.',
    network_unconfirmed: 'تعذّر التأكد من اكتمال العملية. حدّث الصفحة للتحقق قبل المحاولة مرة أخرى.',
    bad_credentials: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    bad_code: 'رمز التحقق غير صحيح. تحقّق من تطبيق المصادقة وحاول مرة أخرى.',
    locked: 'تم قفل الحساب مؤقتًا بعد عدة محاولات فاشلة. حاول لاحقًا.',
    rate_limited: 'محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.',
    mfa_expired: 'يرجى تسجيل الدخول مرة أخرى.',
    unauthorized: 'يرجى تسجيل الدخول.',
    forbidden: 'حسابك للعرض فقط.',
    weak_password: 'يجب أن تتكون كلمة المرور من 10 أحرف على الأقل.',
    bad_username: 'اسم المستخدم: من 3 إلى 32 حرفًا أو رقمًا أو . _ -',
    exists: 'هذا الاسم مستخدم بالفعل.',
    last_admin: 'لا يمكن حذف آخر مسؤول.',
    self: 'لا يمكنك حذف حسابك.',
    mfa_already_enabled: 'التحقق بخطوتين مفعّل بالفعل.',
    mfa_not_enabled: 'التحقق بخطوتين غير مفعّل.',
    mfa_not_setup: 'ابدأ إعداد التحقق بخطوتين أولًا.',
    bad_name: 'الاسم مطلوب.',
    bad_description: 'العارضون الظاهرون يحتاجون إلى وصف (400 حرف كحد أقصى).',
    bad_categories: 'يرجى اختيار فئة صحيحة واحدة على الأقل.',
    bad_image: 'يجب أن تكون الصورة بصيغة JPEG أو PNG أو WebP.',
    photo_required: 'العارضون الظاهرون يحتاجون إلى صورة.',
    duplicate_category_assignment: 'هذا الصانع والمشروع مسجّلان بالفعل في إحدى الفئات المختارة. عدّل العارض الموجود لإضافة فئات أخرى.',
    has_votes: 'توجد أصوات مرتبطة بهذا العنصر.',
    category_in_use: 'هذه هي الفئة الوحيدة لعارض ظاهر. انقل العارض إلى فئة أخرى أو أخفِه أولًا.',
    not_found: 'العنصر غير موجود.',
    bad_cidr: 'نطاق شبكة غير صالح. تحقّق من العناوين المدخلة.',
    bad_geofence: 'تحقّق من خط العرض وخط الطول ونصف القطر (10–50,000 م) وحد دقة الموقع.',
    bad_date: 'يرجى إدخال تاريخ ووقت صحيحين للجدول.',
    bad_voting_window: 'يجب أن يكون وقت انتهاء التصويت بعد وقت بدئه.',
    confirm_required: 'اكتب RESET للتأكيد.',
  },

  shell: {
    brand: 'جوائز ملتقى الصنّاع 2026', console: 'لوحة الإدارة', logoAlt: 'ملتقى الصنّاع 2026',
    nav: { dashboard: 'لوحة التحكم', exhibitors: 'العارضون', categories: 'الفئات', results: 'النتائج', visitors: 'الزوار', settings: 'الإعدادات' },
    administrator: 'مسؤول', viewer: 'مشاهد (عرض فقط)', signOut: 'تسجيل الخروج', signingOut: 'جارٍ تسجيل الخروج…',
    mfaTip: 'نصيحة: فعّل التحقق بخطوتين من الإعدادات › الحساب والفريق.',
    sessionExpired: 'انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.',
  },

  login: {
    console: 'لوحة الإدارة', signIn: 'تسجيل الدخول', twoFactor: 'التحقق بخطوتين', username: 'اسم المستخدم', password: 'كلمة المرور',
    signingIn: 'جارٍ تسجيل الدخول…', retryIn: (c) => `أعد المحاولة بعد ${c}`, codeHelp: 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.',
    code: 'رمز المصادقة', verify: 'تحقّق', verifying: 'جارٍ التحقق…', back: 'رجوع',
    showPassword: 'إظهار كلمة المرور', hidePassword: 'إخفاء كلمة المرور',
  },

  dash: {
    title: 'لوحة التحكم',
    open: 'التصويت مفتوح', openUntil: (t) => `يُغلق تلقائيًا في ${t}.`, openNow: 'يمكن للزوار الموثَّقين داخل الموقع التصويت الآن.',
    opensAt: (t) => `يُفتح التصويت في ${t}`, waiting: 'التصويت مفعّل وسيبدأ حسب الجدول.',
    ended: 'انتهى التصويت', endedAt: (t) => `انتهى التصويت في ${t}.`,
    closed: 'التصويت مغلق', closedNow: 'لا يمكن للزوار التصويت حاليًا.',
    openBtn: 'فتح التصويت', closeBtn: 'إيقاف التصويت مؤقتًا', updating: 'جارٍ التحديث…',
    endBtn: 'إنهاء التصويت', confirmEnd: 'هل تريد إنهاء التصويت الآن؟ سيظهر للزوار أن التصويت انتهى وعليهم انتظار النتائج.', endedToast: 'انتهى التصويت. ينتظر الزوار إعلان النتائج.',
    continueBtn: 'إعادة الفتح مع الأصوات الحالية', restartBtn: 'حذف الأصوات والبدء من جديد', confirmRestart: 'سيؤدي هذا إلى حذف جميع الأصوات نهائيًا وإعادة فتح التصويت فورًا. ستبقى حسابات الزوار المسجلة. اكتب RESET للمتابعة.', restartDone: (n) => `أُعيد بدء التصويت. تم حذف ${n} صوت.`,
    openNowBtn: 'افتح الآن', reopenBtn: 'إعادة فتح التصويت', switchOff: 'إيقاف',
    openedNow: 'تم فتح التصويت. تم مسح أوقات الجدول التي كانت تؤخّر فتحه.',
    confirmClose: 'إيقاف التصويت مؤقتًا؟ لن يتمكن الزوار من التصويت حتى تعيد فتحه.',
    opened: 'تم فتح التصويت', closedToast: 'تم إيقاف التصويت مؤقتًا',
    schedule: 'الجدول الزمني', scheduleSub: 'اختياري · بتوقيت عمّان', opens: 'يبدأ', closes: 'ينتهي', clear: 'مسح',
    scheduleHint: 'عندما يكون التصويت مفتوحًا، تُقبل الأصوات فقط بين هذين الوقتين. اتركهما فارغين لفتح التصويت وإغلاقه يدويًا.',
    scheduleSaved: 'تم حفظ الجدول', scheduleCleared: 'تم مسح الجدول',
    showWinners: 'عرض الفائزين على الشاشة', hideWinners: 'إخفاء الفائزين', winnersShown: 'يتم الآن عرض الفائزين على شاشة النتائج', winnersHidden: 'تم إخفاء الفائزين من شاشة النتائج',
    winnersHint: 'عند انتهاء التصويت، أعلن الفائزين على شاشة النتائج.', winnersOn: 'تعرض شاشة النتائج الفائزين النهائيين.',
    protection: 'الحماية داخل الموقع', protectionOff: 'متوقفة. يمكن لأي شخص من أي مكان التصويت.', change: 'تغيير', fixNow: 'إصلاح الآن',
    statsDown: 'الإحصاءات لا تتحدّث.', statsLast: 'يتم عرض آخر القيم.', retrying: 'تتم إعادة المحاولة تلقائيًا.',
    votes: 'الأصوات المُدلى بها', verified: 'الزوار الموثَّقون', recent: 'الأصوات في آخر 5 دقائق', onBallot: 'العارضون في الاقتراع', blocked: 'محاولات الوصول من خارج الموقع المحظورة',
    leading: 'المتصدّرون الآن', live: 'مباشر', polling: 'يتحدّث كل 5 ثوانٍ', reconnecting: 'جارٍ إعادة الاتصال…', connecting: 'جارٍ الاتصال…',
    showingFrom: (t) => `يتم عرض النتائج من ${t}.`, loadingStandings: 'جارٍ تحميل الترتيب…',
    votesCount: (n) => `${n} صوت`, noVotes: 'لا توجد أصوات بعد', allResults: 'جميع النتائج والتصدير',
    share: 'المشاركة', votePage: 'صفحة التصويت', voteLink: 'رابط التصويت', openPage: 'فتح الصفحة', openPageHint: 'يفتح صفحة التصويت على هذا الجهاز. بصفتك مسؤولًا مسجّلًا يمكنك تسجيل الدخول والتصويت للتجربة دون مسح رمز QR.',
    localWarn: 'لا تستطيع الهواتف فتح localhost. افتح لوحة الإدارة عبر عنوان الشبكة المحلية للفعالية؛ وستستخدم روابط التصويت العنوان نفسه تلقائيًا.',
    screen: 'شاشة النتائج (التلفاز)', screenNote: 'رابط خاص. يمكن لأي شخص يملكه رؤية النتائج المباشرة.',
    copyLink: 'نسخ الرابط', copyKey: 'نسخ المفتاح فقط', regenKey: 'إنشاء مفتاح جديد', regenerating: 'جارٍ الإنشاء…', keyRegenerated: 'تم إنشاء مفتاح جديد للشاشة. الروابط القديمة والشاشات المفتوحة بها لن تعمل بعد الآن.',
    confirmRegen: 'هل تريد إنشاء مفتاح جديد للشاشة؟ سيتوقف المفتاح القديم وجميع الروابط التي تمت مشاركتها، وستطلب الشاشات المفتوحة به المفتاح الجديد.', screenKey: 'مفتاح الشاشة', openScreen: 'فتح الشاشة', screenLink: 'رابط الشاشة',
  },

  modes: {
    ip_or_geo: ['شبكة الموقع أو الموقع الجغرافي', 'مُوصى به. يمر المتصلون بشبكة الموقع مباشرة، ويشارك مستخدمو بيانات الهاتف موقعهم.'],
    ip: ['شبكة الموقع فقط', 'الأكثر صرامة. يمكن التصويت من شبكة الموقع فقط.'],
    geo: ['الموقع الجغرافي فقط', 'يجب أن يكون الهاتف داخل نطاق الموقع.'],
    ip_and_geo: ['الشبكة والموقع معًا', 'يجب اجتياز الفحصين معًا.'],
    off: ['متوقفة', 'يمكن لأي شخص من أي مكان التصويت. للاختبار فقط.'],
  },
  summary: {
    networks: (n) => (n === 1 ? 'شبكة واحدة' : n === 2 ? 'شبكتان' : `${n} شبكات`), noNetwork: 'لم تُحدَّد شبكة',
    radius: (m) => `نصف قطر ${m} م`, noLocation: 'لم يُحدَّد موقع',
  },

  settings: {
    title: 'الإعدادات',
    tabs: { access: 'التحقق من الموقع', event: 'الفعالية والشاشة', account: 'الحساب', activity: 'سجل النشاط' },
  },

  access: {
    who: 'من يمكنه التصويت',
    intro: 'يمكن للموجودين في الموقع فقط التصويت. في كل فعالية جديدة، اتصل بشبكة Wi-Fi للموقع واستخدم الشبكة المكتشفة وموقعك، ثم احفظ.',
    rule: 'القاعدة', offWarning: 'عند إيقاف القاعدة، يمكن للأشخاص خارج الموقع التصويت. استخدمها للاختبار فقط.',
    network: 'شبكة الموقع', thisNetwork: 'شبكة هذا الجهاز', allowed: 'مسموح', useNetwork: 'استخدم هذه الشبكة',
    networks: 'الشبكات المسموح بها (شبكة في كل سطر)', networksPh: '37.220.1.0/24',
    networkHint: 'عند فتح الصفحة عبر بوابة شبكة الفعالية، تتم إضافة شبكة Wi-Fi المكتشفة تلقائيًا. وإلا فاطلب نطاق الشبكة من فريق تقنية المعلومات.',
    unused: 'غير مستخدم في القاعدة المختارة.',
    location: 'موقع الفعالية', useLocation: 'استخدم موقعي', locating: 'جارٍ تحديد الموقع…', viewMap: 'عرض على الخريطة',
    lat: 'خط العرض', lng: 'خط الطول', radius: 'نصف القطر (م)', accuracy: 'أقصى خطأ في GPS (م)',
    radiusHint: 'يجب أن يغطي نصف القطر الموقع بالكامل. 150 م مناسب لمعظم القاعات.',
    locationSet: (m) => `تم تحديد الموقع (بدقة ${m} م). احفظ لتطبيقه.`,
    locationFailed: 'تعذّر تحديد موقعك. اسمح بالوصول إلى الموقع في المتصفح وحاول مرة أخرى.',
    unsaved: 'لديك تغييرات غير محفوظة.', allSaved: 'تم حفظ جميع التغييرات.', saveRules: 'حفظ القواعد', saved: 'تم حفظ القواعد وتطبيقها فورًا.',
  },

  event: {
    details: 'تفاصيل الفعالية', detailsIntro: 'تظهر في صفحة التصويت وعلى شاشة النتائج.',
    name: 'اسم الجوائز', tagline: 'الشعار', venue: 'المكان', save: 'حفظ التفاصيل', saved: 'تم حفظ تفاصيل الفعالية',
    address: 'عنوان صفحة التصويت', addressHint: 'يفتح رمز QR هذا العنوان على هواتف الزوار. اتركه فارغًا لاستخدام العنوان نفسه الذي فتحت به لوحة الإدارة.',
    addressLocal: 'لا تستطيع الهواتف فتح localhost. افتح لوحة الإدارة عبر عنوان الشبكة المحلية للفعالية أو أدخل عنوانًا عامًا اختياريًا.',
    screen: 'شاشة النتائج', screenIntro: 'ما تعرضه الشاشة العامة أثناء الفعالية.',
    withCounts: 'الترتيب وعدد الأصوات', rankingsOnly: 'الترتيب فقط', showsLabel: 'ما تعرضه شاشة النتائج',
    countsOn: 'تعرض الشاشة الآن عدد الأصوات', countsOff: 'تعرض الشاشة الآن الترتيب فقط',
    countsHint: 'إخفاء الأعداد يُبقي النتائج النهائية مفاجأة حتى حفل توزيع الجوائز.',
  },

  security: {
    mfa: 'التحقق بخطوتين', enabled: 'مفعّل', notEnabled: 'غير مفعّل',
    mfaOn: 'يتطلب تسجيل الدخول كلمة المرور ورمزًا من تطبيق المصادقة.',
    disable: 'إيقاف التحقق بخطوتين', disableBtn: 'إيقاف', disabling: 'جارٍ الإيقاف…', disabled: 'تم إيقاف التحقق بخطوتين',
    currentPassword: 'كلمة المرور الحالية', code: 'رمز المصادقة', codePh: 'رمز من 6 أرقام', codeTitle: 'أدخل 6 أرقام بالضبط',
    setupTitle: 'إعداد التحقق بخطوتين', step1: '1. امسح رمز QR هذا باستخدام تطبيق المصادقة.',
    manualKey: 'أو أدخل هذا المفتاح يدويًا:', step2: '2. أدخل الرمز المكوّن من 6 أرقام الذي يظهر:', qrAlt: 'رمز QR للمصادقة',
    turnOn: 'تفعيل التحقق بخطوتين', enabling: 'جارٍ التفعيل…', enabledToast: 'تم تفعيل التحقق بخطوتين',
    mfaIntro: 'احمِ لوحة الإدارة برمز يتغير مع الوقت (Google Authenticator أو Microsoft Authenticator أو 1Password أو Authy…).',
    setup: 'إعداد التحقق بخطوتين', settingUp: 'جارٍ الإعداد…',
    password: 'تغيير كلمة المرور', passwordIntro: 'تغيير كلمة المرور يُنهي جميع الجلسات الأخرى.',
    newPassword: 'كلمة المرور الجديدة (10 أحرف على الأقل)', update: 'تحديث كلمة المرور', updating: 'جارٍ التحديث…', changed: 'تم تغيير كلمة المرور',
    team: 'حسابات الفريق', cols: ['المستخدم', 'الدور', 'آخر تسجيل دخول', ''], on: 'مفعّل', off: 'غير مفعّل',
    roles: { admin: 'مسؤول', viewer: 'مشاهد (عرض فقط)' },
    loadingTeam: 'جارٍ تحميل حسابات الفريق…', teamError: (e) => `تعذّر تحميل حسابات الفريق: ${e}. اضغط إعادة المحاولة.`,
    noTeam: 'لا توجد حسابات.', remove: 'إزالة', removing: 'جارٍ الإزالة…', confirmRemove: (u) => `إزالة ${u}؟`,
    removed: 'تمت إزالة المستخدم', usernamePh: 'اسم المستخدم', usernameTitle: 'من 3 إلى 32 حرفًا أو رقمًا أو نقطة أو شرطة',
    tempPassword: 'كلمة مرور مؤقتة (10+)', add: 'إضافة مستخدم', adding: 'جارٍ الإضافة…', added: 'تمت إضافة المستخدم',
  },

  audit: {
    intro: 'آخر 100 عملية تسجيل دخول وتعديل وتصدير، الأحدث أولًا.',
    cols: ['الوقت', 'المستخدم', 'الإجراء', 'IP'], empty: 'لا يوجد نشاط بعد.', details: 'عرض التفاصيل',
    loadError: (e) => `تعذّر تحديث سجل النشاط: ${e}`, showingOld: ' يتم عرض السجلات المحمّلة سابقًا.',
    actions: {
      login: 'تسجيل دخول', login_failed: 'فشل تسجيل الدخول', mfa_failed: 'فشل رمز التحقق', mfa_enabled: 'تفعيل التحقق بخطوتين',
      mfa_disabled: 'إيقاف التحقق بخطوتين', password_changed: 'تغيير كلمة المرور', user_created: 'إضافة مستخدم', user_deleted: 'حذف مستخدم',
      category_created: 'إضافة فئة', category_updated: 'تعديل فئة', category_deleted: 'حذف فئة',
      exhibitor_created: 'إضافة عارض', exhibitor_updated: 'تعديل عارض', exhibitor_deleted: 'حذف عارض',
      settings_updated: 'تعديل الإعدادات', display_key_rotated: 'رابط شاشة جديد', display_auth_failed: 'فشل الوصول إلى الشاشة',
      results_exported: 'تصدير النتائج', visitors_exported: 'تصدير الزوار', results_reset: 'إعادة تعيين النتائج', results_restarted: 'إعادة التصويت وحذف الأصوات', visitors_purged: 'حذف بيانات الزوار',
    },
  },

  cat: {
    title: 'فئات الجوائز',
    manage: 'العارضون', membersTitle: (n) => `العارضون في «${n}»`, membersHint: 'ضع إشارة لإضافة العارض إلى هذه الفئة، وأزلها لإزالته منها. تُحفظ التغييرات فورًا.',
    noExhibitors: 'لا يوجد عارضون بعد.', membersSaved: 'تم تحديث الفئة', checkAll: 'تحديد الكل', clearAll: 'إلغاء تحديد الكل',
    bulkSkipped: (n: number) => `تعذّر تغيير ${n} عارض (يجب أن يبقى العارض الظاهر في فئة واحدة على الأقل).`,
    add: '+ إضافة فئة', noDescription: 'لا يوجد وصف', exhibitors: (n) => `${n} عارض`, hidden: 'مخفية',
    confirmDelete: (n) => `حذف الفئة «${n}»؟`,
    confirmForce: (n) => `توجد أصوات في هذه الفئة. حذف «${n}» نهائيًا مع جميع أصواتها؟ سيؤدي ذلك أيضًا إلى إزالة ارتباط العارضين بها، وقد يبقى بعضهم دون فئة. لا يمكن التراجع عن ذلك.`,
    forceBtn: 'حذف مع الأصوات', deleted: 'تم حذف الفئة', saved: 'تم حفظ الفئة',
    addTitle: 'إضافة فئة', editTitle: 'تعديل فئة', name: 'الاسم', slug: 'المعرّف (اختياري)', slugPh: 'مثل community-choice',
    slugHint: 'اتركه فارغًا ليُنشأ من الاسم. يجب أن يكون فريدًا، وتتحول المسافات والرموز إلى شرطات عند الحفظ.',
    description: 'الوصف (يظهر للزوار)', active: 'مفعّلة',
  },

  ex: {
    title: 'العارضون', sub: (n) => `${n} عارض · الصور والأوصاف والفئات`,
    add: '+ إضافة عارض', search: 'ابحث عن عارض…', cols: ['', 'المشروع / الصانع', 'الجناح', 'الفئات', 'الأصوات', 'الحالة', ''],
    noMatch: 'لا توجد نتائج.', empty: 'لا يوجد عارضون بعد. أضف العارض الأول.', visible: 'ظاهر', hidden: 'مخفي',
    confirmDelete: (n) => `حذف «${n}»؟`,
    confirmForce: 'توجد أصوات لهذا العارض. حذفه مع تلك الأصوات؟ يمكنك إخفاؤه بدلًا من ذلك بإلغاء تحديد «ظاهر».',
    forceBtn: 'حذف مع الأصوات', deleted: 'تم حذف العارض', addedToast: 'تمت إضافة العارض', savedToast: 'تم حفظ العارض',
    confirmSaveForce: 'إزالة هذا العارض من فئة ستحذف أصواته فيها. هل تريد المتابعة؟', saveForceBtn: 'حذف الأصوات والحفظ',
    addTitle: 'إضافة عارض', editTitle: 'تعديل عارض',
    required: 'العارضون الظاهرون يحتاجون إلى صورة ووصف قصير وفئة واحدة على الأقل.',
    missing: (list) => `يرجى إضافة: ${list.join('، ')}.`,
    missName: 'اسم الصانع أو الفريق', missPhoto: 'صورة (ارفع صورة أو ألغِ تحديد «ظاهر»)', missDescription: 'وصف قصير', missCategory: 'فئة واحدة على الأقل',
    noPhoto: 'لا توجد صورة', photo: 'الصورة', photoBad: 'يجب أن تكون الصورة بصيغة JPEG أو PNG أو WebP وأقل من 3 ميغابايت.',
    photoHint: 'JPEG أو PNG أو WebP · حتى 3 ميغابايت · الصورة الأفقية 4:3 هي الأفضل', removePhoto: 'إزالة الصورة',
    replacePhoto: 'ارفع صورة بديلة أو ألغِ تحديد «ظاهر في صفحة التصويت» قبل الحفظ.',
    project: 'اسم المشروع', projectPh: 'مثل SolarSip', maker: 'الصانع / الفريق', makerPh: 'اسم الشخص أو الفريق',
    booth: 'الجناح', boothPh: 'مثل B4', visibleCheck: 'ظاهر في صفحة التصويت',
    description: 'وصف قصير', descriptionPh: 'جملة أو جملتان يراها الزوار',
    competes: 'يتنافس في', competesReq: ' (اختر فئة واحدة على الأقل)',
    noCategories: 'أنشئ فئة أولًا، أو ألغِ تحديد «ظاهر» لحفظ العارض مخفيًا.',
    saveNew: 'إضافة العارض', saveEdit: 'حفظ التغييرات',
  },

  results: {
    title: 'النتائج', sub: (v, p, t) => `${v} صوت من ${p} زائر موثَّق · آخر تحديث ${t}`,
    csv: 'تصدير CSV', json: 'تصدير JSON', reset: 'إعادة تعيين النتائج…', votes: (n) => `${n} صوت`,
    resetTitle: 'إعادة تعيين النتائج',
    resetBody: 'سيؤدي هذا إلى إغلاق التصويت وحذف جميع الأصوات نهائيًا. سيبقى التصويت مغلقًا حتى تعيد فتحه. تُحفظ نسخة من الأعداد الحالية في سجل النشاط. صدّر البيانات أولًا إذا كنت تحتاجها.',
    purge: 'حذف جميع تسجيلات الزوار أيضًا (الأسماء وأرقام الهواتف)', confirmReset: 'أفهم أن هذا سيحذف جميع الأصوات نهائيًا ويغلق التصويت.', adminPassword: 'كلمة مرور المسؤول',
    deleteAll: 'حذف جميع الأصوات', resetDone: (n) => `تم إغلاق التصويت وحذف ${n} صوت.`,
  },

  visitors: {
    title: 'الزوار', sub: 'تتضمن ملفات التصدير الزوار الموثَّقين وأرقام هواتفهم كاملة، ويُسجَّل التصدير في سجل النشاط. يتضمن التصدير الأول فقط من وافقوا على تلقي أخبار الفعاليات القادمة؛ أما تصدير جميع الزوار الموثَّقين فيشمل الجميع، حتى من لم يوافقوا.',
    exportOptIn: 'تصدير الموافقين على أخبار الفعاليات', exportAll: 'تصدير جميع الزوار الموثَّقين',
    cols: ['الاسم', 'الهاتف', 'تاريخ التحقق', 'الأصوات', 'موافقة التواصل'], empty: 'لا يوجد زوار موثَّقون بعد.',
  },

  notFound: 'هذه الصفحة غير موجودة.',
};

const DICTS: Record<Lang, Dict> = { en, ar };

/** Translated text for an API or client error: by error code, else the server message. */
export function errorText(t: Dict, error: unknown): string {
  const e = error as Partial<ApiError> & { message?: string };
  if (e?.code && t.errors[e.code]) return t.errors[e.code];
  if (t.dir === 'rtl' && e?.code) return t.errors.generic;
  return e?.message || t.errors.generic;
}

interface LangCtx { lang: Lang; t: Dict; setLang: (l: Lang) => void; err: (e: unknown) => string }
const Ctx = createContext<LangCtx | null>(null);
export const useLang = () => useContext(Ctx)!;

/** Admin language, remembered per device; sets <html lang/dir> for RTL. */
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => safeStore.get<Lang>('admin-lang', true) === 'ar' ? 'ar' : 'en');
  const t = DICTS[lang];
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
    return () => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; };
  }, [lang, t.dir]);
  const value = useMemo<LangCtx>(() => ({
    lang, t, err: (e) => errorText(t, e),
    setLang: (l) => { setLangState(l); safeStore.set('admin-lang', l, true); },
  }), [lang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function LangToggle() {
  const { lang, t, setLang } = useLang();
  return (
    <button type="button" className="lang-toggle" lang={lang === 'en' ? 'ar' : 'en'} aria-label={t.switchLabel} title={t.switchLabel}
      onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
      {t.switchTo}
    </button>
  );
}
