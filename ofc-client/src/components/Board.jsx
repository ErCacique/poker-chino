import { Card, EmptySlot } from './Card.jsx';
import { ROW_LABEL, ROW_SIZE, orderCheck } from '../lib/cards.js';

const ROWS = ['top', 'middle', 'bottom'];

/**
 * Tablero de un jugador. `pendingCards` son las cartas colocadas en esta jugada
 * pero aún no confirmadas: se pintan distintas porque todavía se pueden deshacer.
 *
 * El riel de la izquierda es el aviso de orden: marca en rojo el escalón donde
 * la fila de arriba ya supera a la de abajo, que es exactamente la condición que
 * ensucia la mano y la convierte en una derrota automática.
 */
export function Board({ board, size = 'md', interactive = false, pendingCards = [], onRowTap, dimmed = false }) {
  const order = orderCheck(board);
  const pending = new Set(pendingCards);

  return (
    <div className={`board ${dimmed ? 'board--dimmed' : ''}`}>
      <div className="board__rail" aria-hidden="true">
        <span className={`rail__step ${order.topOverMiddle ? 'is-broken' : ''}`} />
        <span className={`rail__step ${order.middleOverBottom ? 'is-broken' : ''}`} />
      </div>

      <div className="board__rows">
        {ROWS.map((row) => {
          const cards = board[row];
          const empties = ROW_SIZE[row] - cards.length;
          return (
            <div
              key={row}
              className={`row row--${row} ${interactive ? 'is-droppable' : ''}`}
              data-row={interactive ? row : undefined}
              onClick={interactive && onRowTap ? () => onRowTap(row) : undefined}
            >
              <span className="row__label">{ROW_LABEL[row]}</span>
              <div className="row__cards">
                {cards.map((card) => (
                  <Card
                    key={card}
                    card={card}
                    size={size}
                    tone={pending.has(card) ? 'pending' : 'placed'}
                  />
                ))}
                {Array.from({ length: empties }, (_, i) => <EmptySlot key={`e${i}`} size={size} />)}
              </div>
            </div>
          );
        })}
      </div>

      {order.broken && (
        <p className="board__warning" role="status">
          Con lo colocado, una fila de arriba supera a la de abajo. Si acabas así, la mano no puntúa.
        </p>
      )}
    </div>
  );
}
