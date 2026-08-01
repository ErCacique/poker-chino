import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '../lib/auth.js';

/** Clasificación de los últimos 30 días, ordenada por puntos por mano. */
export function Leaderboard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard({ days: 30, minHands: 5 })
      .then((data) => !cancelled && setRows(data))
      .catch((failure) => !cancelled && setError(failure.message));
    return () => { cancelled = true; };
  }, []);

  if (error) return null;
  if (!rows) return <p className="board-note">Cargando clasificación…</p>;
  if (!rows.length) return <p className="board-note">Aún no hay manos suficientes para clasificar.</p>;

  return (
    <section className="ranking">
      <h3>Últimos 30 días</h3>
      <ol className="ranking__list">
        {rows.slice(0, 10).map((row, index) => (
          <li key={row.id}>
            <span className="ranking__pos">{index + 1}</span>
            <span className="ranking__name">{row.name}</span>
            <span className="ranking__ppm">{row.pointsPerHand > 0 ? `+${row.pointsPerHand}` : row.pointsPerHand}</span>
            <span className="ranking__meta">{row.hands} manos · {row.foulPct}% sucias</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
