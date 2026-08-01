/**
 * Utilidades de presentación de cartas y lectura rápida del orden de filas.
 * La validación real vive en el servidor; esto sólo alimenta la interfaz.
 */

export const SUITS = {
  c: { symbol: '♣', color: 'dark' },
  s: { symbol: '♠', color: 'dark' },
  d: { symbol: '♦', color: 'red' },
  h: { symbol: '♥', color: 'red' },
};

const RANK_CHARS = '23456789TJQKA';

export function rankOf(card) {
  return RANK_CHARS.indexOf(card[0]) + 2;
}

export function rankLabel(card) {
  return card[0] === 'T' ? '10' : card[0];
}

export function suitOf(card) {
  return SUITS[card[1]] ?? { symbol: '?', color: 'dark' };
}

export const ROW_SIZE = { top: 3, middle: 5, bottom: 5 };
export const ROW_LABEL = { top: 'Arriba', middle: 'Medio', bottom: 'Abajo' };

/**
 * Fuerza aproximada de una fila incompleta: sólo repeticiones, sin escaleras ni
 * colores. Sirve para avisar de un orden invertido mientras se coloca, no para
 * puntuar: dos filas incompletas pueden cambiar de orden al completarse.
 */
export function partialStrength(cards) {
  const counts = new Map();
  for (const card of cards) {
    const rank = rankOf(card);
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (!groups.length) return [0, 0, 0];
  const [rank, n] = groups[0];
  const category = n >= 3 ? 3 : n === 2 ? (groups[1]?.[1] === 2 ? 2 : 1) : 0;
  return [category, rank, groups[1]?.[0] ?? 0];
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

/**
 * Comprueba el orden arriba ≤ medio ≤ abajo sobre lo ya colocado.
 * @returns {{topOverMiddle:boolean, middleOverBottom:boolean, broken:boolean}}
 */
export function orderCheck(board) {
  const top = partialStrength(board.top);
  const middle = partialStrength(board.middle);
  const bottom = partialStrength(board.bottom);
  const topOverMiddle = board.top.length > 0 && board.middle.length > 0 && compare(top, middle) > 0;
  const middleOverBottom = board.middle.length > 0 && board.bottom.length > 0 && compare(middle, bottom) > 0;
  return { topOverMiddle, middleOverBottom, broken: topOverMiddle || middleOverBottom };
}
