/** Ajustes puramente locales: no hay servidor de por medio, cada dispositivo los suyos. */

const KEY = 'ofc.settings';

export const DECKS = [
  { id: 'classic', label: 'Clásica' },
  { id: 'noir', label: 'Noir' },
  { id: 'royal', label: 'Royal' },
  { id: 'mint', label: 'Menta' },
];

const DEFAULTS = { theme: 'dark', sound: true, deck: 'classic' };

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
  applyDeck(settings.deck);
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function applyDeck(deck) {
  document.documentElement.dataset.deck = deck;
}
