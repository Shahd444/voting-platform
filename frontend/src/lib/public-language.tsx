import { useLayoutEffect, useState } from 'react';
import { safeStore } from './util';

export type PublicLang = 'en' | 'ar';
export function usePublicLanguage() {
  const [lang, setLang] = useState<PublicLang>(() => safeStore.get('lang', true) === 'ar' ? 'ar' : 'en');
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    safeStore.set('lang', lang, true);
    return () => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; };
  }, [lang]);
  return { lang, setLang };
}

export function PublicLanguageButton({ lang, setLang }: { lang: PublicLang; setLang: (lang: PublicLang) => void }) {
  return <button className="public-language" type="button" lang={lang === 'en' ? 'ar' : 'en'} dir="ltr"
    aria-label={lang === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
    onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{lang === 'en' ? 'العربية' : 'English'}</button>;
}
