const TABS = [
  { id: 'jugar', label: 'Jugar' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'perfil', label: 'Perfil' },
];

export function BottomNav({ active, onChange }) {
  return (
    <nav className="bottomnav">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={active === tab.id ? 'is-active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
