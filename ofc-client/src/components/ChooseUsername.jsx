import { useState } from 'react';
import { setUsername as saveUsername } from '../lib/auth.js';

/** Pantalla bloqueante: sin username propio no se puede entrar al lobby. */
export function ChooseUsername({ session, onDone }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const updated = await saveUsername(session.token, value.trim());
      onDone(updated);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel panel--waiting">
      <h2>Elige tu nombre</h2>
      <p>Así te verán el resto de jugadores en la mesa y en la clasificación.</p>
      <form className="field" onSubmit={handleSubmit} style={{ width: '100%' }}>
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="3-16 caracteres"
          maxLength={16}
          autoFocus
          disabled={pending}
        />
        <button type="submit" className="btn btn--primary" disabled={pending || !value.trim()}>
          {pending ? 'Guardando…' : 'Confirmar'}
        </button>
      </form>
      {error && <p className="alert" role="alert">{error}</p>}
    </section>
  );
}
