import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { ru } from './ru';

/**
 * Локаль пока одна, но строки вынесены с первого дня (ADR-012):
 * вытаскивать их из компонентов задним числом — работа на несколько дней
 * и источник пропусков.
 */
void i18n.use(initReactI18next).init({
  resources: { ru },
  lng: 'ru',
  fallbackLng: 'ru',
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
