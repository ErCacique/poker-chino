/** Ajustes puramente locales: no hay servidor de por medio, cada dispositivo los suyos. */

const KEY = 'ofc.settings';

const DEFAULTS = { theme: 'dark', sound: true };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
  applyTheme(settings.theme);
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}
