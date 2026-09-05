import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './fr.json';
import en from './en.json';

const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('light-maestro-lang') : null;

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: saved || 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = (saved || 'fr');
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
    try { localStorage.setItem('light-maestro-lang', lng); } catch {}
  });
}

export default i18n;
