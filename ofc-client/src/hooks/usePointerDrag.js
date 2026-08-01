import { useEffect, useRef, useState } from 'react';

/**
 * Arrastre basado en Pointer Events. Se descarta la API de drag & drop de HTML5
 * porque no dispara en navegadores táctiles, que son el objetivo aquí.
 *
 * El destino se resuelve con elementFromPoint contra el atributo data-row, así
 * que cualquier zona soltable sólo necesita declarar data-row="top|middle|bottom".
 *
 * @param {(card:string, row:string)=>void} onDrop
 */
export function usePointerDrag(onDrop) {
  const [drag, setDrag] = useState(null); // { card, x, y, active }
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  // Refleja drag.active sin pasar por el estado: en StrictMode, React invoca
  // dos veces las funciones actualizadoras de setState (para detectar efectos
  // secundarios impuros), así que onDrop no puede dispararse desde dentro de
  // una de ellas o se llama dos veces por cada suelta.
  const activeRef = useRef(false);

  useEffect(() => {
    if (!drag) return undefined;
    const card = drag.card;
    const origin = { x: drag.x, y: drag.y };
    activeRef.current = false;

    const move = (event) => {
      const far = Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6;
      if (far) activeRef.current = true;
      setDrag((current) => {
        if (!current) return current;
        if (!current.active && !far) return current;
        return { ...current, x: event.clientX, y: event.clientY, active: true };
      });
      if (far) event.preventDefault();
    };
    const drop = (event) => {
      // Sin arrastre real no se suelta nada: el toque simple lo gestiona el click.
      if (activeRef.current) {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const row = target?.closest('[data-row]')?.dataset.row;
        if (row) onDropRef.current(card, row);
      }
      setDrag(null);
    };
    const cancel = () => setDrag(null);

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [drag?.card]);

  return {
    drag,
    start: (card, event) => setDrag({ card, x: event.clientX, y: event.clientY, active: false }),
  };
}
