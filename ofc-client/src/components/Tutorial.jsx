const SEEN_KEY = 'ofc.tutorialSeen';

export function shouldShowTutorial() {
  return !localStorage.getItem(SEEN_KEY);
}

export function Tutorial({ onClose }) {
  function close() {
    localStorage.setItem(SEEN_KEY, '1');
    onClose();
  }
  return (
    <div className="profile-overlay" onClick={close}>
      <div className="profile-panel" onClick={(e) => e.stopPropagation()}>
        <div className="profile-panel__head">
          <h2>Cómo se juega</h2>
          <button type="button" className="profile-panel__close" onClick={close} aria-label="Cerrar">×</button>
        </div>
        <div className="profile-body">
          <p>Recibes cartas y las colocas en tres filas: <b>Arriba</b> (3 cartas), <b>Medio</b> (5) y <b>Abajo</b> (5).</p>
          <p>Cada fila de abajo hacia arriba debe ser igual o mejor que la de encima — si no, es mano sucia y pierdes la ronda.</p>
          <p>Primera calle: 5 cartas, todas se colocan. Luego 4 rondas más de 3 cartas, colocas 2 y descartas 1.</p>
          <p>Ganas puntos comparando fila contra fila con cada rival, más bonus por manos fuertes (royalties).</p>
          <p>Si haces QQ o mejor en la fila de Arriba, entras en <b>Fantasyland</b>: la siguiente mano recibes tus cartas de golpe.</p>
          <button type="button" className="btn btn--primary" onClick={close} style={{ width: '100%' }}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
