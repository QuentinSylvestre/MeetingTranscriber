import React, { createContext, useContext, useState, useEffect } from 'react';
import { en, fr, type I18nKey } from '../i18n';

type Lang = 'en' | 'fr';
type I18nContextValue = { t: (key: I18nKey) => string; lang: Lang; setLang: (l: Lang) => void };

const I18nContext = createContext<I18nContextValue>({
  t: (k) => en[k],
  lang: 'en',
  setLang: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [lang, setLang] = useState<Lang>('en'); // in-memory default is English

  useEffect(() => {
    // Guard: preload may not have fired yet (unlikely but defensive)
    if (!window.electronAPI) { setLang('fr'); return; }
    // Load stored preference; switch to French (or stored value) after mount
    (window.electronAPI.invoke('settings:get-preference', { key: 'appLanguage' }) as Promise<{ value: unknown }>)
      .then(res => {
        const stored = res?.value as Lang | undefined;
        if (stored === 'fr' || stored === 'en') setLang(stored);
        else setLang('fr'); // stored default is French
      })
      .catch(() => setLang('fr'));
  }, []); // mount-only

  const t = (key: I18nKey): string => (lang === 'fr' ? fr[key] : en[key]);

  return <I18nContext.Provider value={{ t, lang, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
