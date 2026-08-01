export function UpdateNotification({ update, isInstalling, onInstall }) {
  if (!update) return null;

  return (
    <div className="update-notification">
      <p>Actualización disponible: v{update.version}</p>
      <button
        type="button"
        onClick={onInstall}
        disabled={isInstalling}
        className="btn btn--primary"
      >
        {isInstalling ? 'Instalando…' : 'Actualizar ahora'}
      </button>
    </div>
  );
}
