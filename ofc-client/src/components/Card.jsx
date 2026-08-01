import { rankLabel, suitOf } from '../lib/cards.js';

export function Card({ card, size = 'md', tone = 'placed', selected = false, ghost = false, ...rest }) {
  const suit = suitOf(card);
  const classes = [
    'card',
    `card--${size}`,
    `card--${tone}`,
    `card--${suit.color}`,
    selected ? 'is-selected' : '',
    ghost ? 'card--ghost' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} {...rest}>
      <span className="card__rank">{rankLabel(card)}</span>
      <span className="card__suit">{suit.symbol}</span>
    </div>
  );
}

export function EmptySlot({ size = 'md' }) {
  return <div className={`slot slot--${size}`} aria-hidden="true" />;
}
