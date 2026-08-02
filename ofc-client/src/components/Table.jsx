import { useEffect, useMemo, useState } from 'react';
import { Board } from './Board.jsx';
import { Card } from './Card.jsx';
import { ROW_SIZE } from '../lib/cards.js';
import { usePointerDrag } from '../hooks/usePointerDrag.js';
import { tapFeedback } from '../lib/native.js';

/** Cuenta atrás corregida con el reloj del servidor. */
function useCountdown(deadline, serverNow) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) { setRemaining(0); return undefined; }
    const update = () => setRemaining(Math.max(0, deadline - serverNow()));
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [deadline, serverNow]);
  return remaining;
}

const CHAT_PHRASES = ['👍', '😂', '😮', '🙏', 'GG'];

export function TableView({ game }) {
  const { table, you, opponents, serverNow, place, ready, leave, chat, sendChat } = game;
  const [pending, setPending] = useState([]);
  const [selected, setSelected] = useState(null);
  const [chatToast, setChatToast] = useState(null);

  useEffect(() => {
    if (!chat) return;
    const name = chat.playerId === you.id ? you.name : opponents.find((p) => p.id === chat.playerId)?.name;
    setChatToast({ id: chat.id, text: `${name ?? '?'}: ${chat.text}` });
    const timer = setTimeout(() => setChatToast((current) => (current?.id === chat.id ? null : current)), 3000);
    return () => clearTimeout(timer);
  }, [chat]);

  const hand = you.hand ?? [];
  const myTurn = table.activePlayerId === you.id || (you.fantasyland && hand.length > 0);
  // Fantasyland progresivo: se reparten 14-17 cartas según la mano que lo
  // ganó, pero el tablero siempre son 13 huecos — lo que cambia es cuánto se
  // descarta (hand.length - 13), no cuánto se coloca.
  const placeCount = you.fantasyland ? 13 : (table.street === 0 ? 5 : 2);
  const deadline = you.fantasyland ? you.deadline : (myTurn ? table.deadline : null);
  const remaining = useCountdown(deadline, serverNow);
  const turnMs = (you.fantasyland ? table.fantasylandMs : table.turnMs) ?? 30_000;

  // Aviso háptico justo al llegar el turno, no en cada reparto de la calle.
  useEffect(() => { if (myTurn) tapFeedback(); }, [myTurn]);

  // Cada reparto nuevo limpia lo que hubiera a medio colocar.
  const handKey = hand.join(',');
  useEffect(() => { setPending([]); setSelected(null); }, [handKey]);

  const pendingBoard = useMemo(() => {
    const board = {
      top: [...you.board.top],
      middle: [...you.board.middle],
      bottom: [...you.board.bottom],
    };
    for (const item of pending) board[item.row].push(item.card);
    return board;
  }, [you.board, pending]);

  const placedNow = new Set(pending.map((item) => item.card));
  const leftover = hand.filter((card) => !placedNow.has(card));
  const complete = pending.length === placeCount;

  function placeCard(card, row) {
    if (!myTurn || placedNow.has(card)) return;
    if (pending.length >= placeCount) return;
    if (pendingBoard[row].length >= ROW_SIZE[row]) return;
    setPending((current) => [...current, { card, row }]);
    setSelected(null);
  }

  const { drag, start } = usePointerDrag(placeCard);

  function handleRowTap(row) {
    if (selected) placeCard(selected, row);
  }

  function confirm() {
    place(pending, leftover);
    setPending([]);
    setSelected(null);
  }

  const showdown = table.phase === 'showdown';

  return (
    <div className="table">
      {chatToast && <div className="chat-toast">{chatToast.text}</div>}
      <header className="table__bar">
        <div className="table__id">
          <span className="eyebrow">Mesa</span>
          <strong>{table.tableId}</strong>
        </div>
        <div className="table__hand">
          <span className="eyebrow">Mano</span>
          <strong>{table.handNumber}</strong>
        </div>
        <button type="button" className="btn btn--ghost" onClick={leave}>Salir</button>
      </header>

      <section className="opponents">
        {opponents.map((player) => (
          <article key={player.id} className={`opponent ${table.activePlayerId === player.id ? 'is-active' : ''}`}>
            <div className="opponent__head">
              <span className="opponent__name">{player.name}</span>
              <span className="opponent__score">{player.score > 0 ? `+${player.score}` : player.score}</span>
              {!player.connected && <span className="tag tag--warn">Sin conexión</span>}
              {player.fantasyland && <span className="tag tag--gold">Fantasyland</span>}
            </div>
            <Board board={player.board} size="sm" dimmed={player.forfeited} />
            {player.fantasyland && !showdown && (
              <p className="opponent__hidden">Coloca a ciegas: {player.placedCount} de 13</p>
            )}
          </article>
        ))}
      </section>

      <section className="mine">
        <div className="mine__head">
          <span className="opponent__name">{you.name}</span>
          <span className="opponent__score">{you.score > 0 ? `+${you.score}` : you.score}</span>
          {you.fantasyland && <span className="tag tag--gold">Fantasyland</span>}
        </div>
        <Board
          board={pendingBoard}
          interactive={myTurn}
          pendingCards={pending.map((item) => item.card)}
          onRowTap={handleRowTap}
        />
      </section>

      <footer className="dock">
        <div className="chat-bar">
          {CHAT_PHRASES.map((phrase) => (
            <button key={phrase} type="button" className="chat-bar__btn" onClick={() => sendChat(phrase)}>
              {phrase}
            </button>
          ))}
        </div>
        {deadline && (
          <div className="clock" aria-label={`Quedan ${Math.ceil(remaining / 1000)} segundos`}>
            <div className="clock__bar" style={{ transform: `scaleX(${Math.min(1, remaining / turnMs)})` }} />
            <span className="clock__value">{Math.ceil(remaining / 1000)}s</span>
          </div>
        )}

        {myTurn ? (
          <>
            <p className="dock__hint">
              {complete
                ? (leftover.length ? `Descartas ${leftover.join(' ')}` : 'Listo para confirmar')
                : `Coloca ${placeCount - pending.length} carta${placeCount - pending.length === 1 ? '' : 's'}: toca una y luego una fila, o arrástrala.`}
            </p>
            <div className="hand">
              {hand.map((card) => (
                <Card
                  key={card}
                  card={card}
                  size="lg"
                  tone={placedNow.has(card) ? 'spent' : 'hand'}
                  selected={selected === card}
                  ghost={drag?.active && drag.card === card}
                  onPointerDown={(event) => {
                    if (!placedNow.has(card)) start(card, event);
                  }}
                  onClick={() => !placedNow.has(card) && setSelected(card === selected ? null : card)}
                />
              ))}
            </div>
            <div className="dock__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPending((current) => current.slice(0, -1))}
                disabled={!pending.length}
              >
                Deshacer
              </button>
              <button type="button" className="btn btn--primary" onClick={confirm} disabled={!complete}>
                Confirmar
              </button>
            </div>
          </>
        ) : (
          <p className="dock__hint">
            {showdown ? 'Mano terminada.' : `Espera: juega ${table.players.find((p) => p.id === table.activePlayerId)?.name ?? 'el rival'}.`}
          </p>
        )}
      </footer>

      {drag?.active && (
        <div className="drag-layer" style={{ left: drag.x, top: drag.y }}>
          <Card card={drag.card} size="lg" tone="hand" />
        </div>
      )}

      {showdown && table.result && (
        <div className="result" role="dialog" aria-label="Resultado de la mano">
          <div className="result__panel">
            <h2>Mano {table.result.handNumber}</h2>
            <ul className="result__list">
              {table.result.players.map((player) => {
                const name = table.players.find((p) => p.id === player.id)?.name ?? player.id;
                return (
                  <li key={player.id} className={player.delta >= 0 ? 'is-up' : 'is-down'}>
                    <span className="result__name">{name}</span>
                    <span className="result__hands">
                      {player.forfeited ? 'Abandono'
                        : player.foul ? 'Mano sucia'
                          : `${player.hands.top} · ${player.hands.middle} · ${player.hands.bottom}`}
                    </span>
                    <span className="result__royalties">{player.royalties ? `+${player.royalties} royalties` : '—'}</span>
                    <span className="result__delta">{player.delta > 0 ? `+${player.delta}` : player.delta}</span>
                    {player.fantasylandNext && <span className="tag tag--gold">Fantasyland</span>}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn btn--primary" onClick={ready}>Siguiente mano</button>
          </div>
        </div>
      )}
    </div>
  );
}
