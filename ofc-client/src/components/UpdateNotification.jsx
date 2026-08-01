export function UpdateNotification({ update, isInstalling, installError, onInstall }) {
  if (!update) return null;

  return (
    <div className="update-notification">
      <div className="update-notification__body">
        <p>Actualización disponible: v{update.version}</p>
        {installError && <p className="update-notification__error">{installError}</p>}
      </div>
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
