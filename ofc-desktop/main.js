const { app, BrowserWindow, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const APP_URL = process.env.OFC_APP_URL || 'https://ofc-client-production.up.railway.app';

// Google bloquea el user-agent por defecto de algunos WebViews embebidos; nos
// identificamos como Chrome de escritorio normal para evitar ese bloqueo.
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: 'Pineapple OFC',
    backgroundColor: '#0F1B22',
    webPreferences: {
      userAgent: DESKTOP_UA,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadURL(APP_URL);

  // El popup de login de Google necesita quedarse DENTRO de la app (misma
  // relación window.opener) para poder devolver el token al cerrarse; si sale
  // al navegador del sistema esa comunicación se rompe y el login nunca
  // termina. Solo los enlaces realmente externos (ayuda, etc.) se mandan
  // fuera.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL) || url.includes('accounts.google.com')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            userAgent: DESKTOP_UA,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  // Configurar auto-update: chequea la versión en el servidor cada hora
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 60 * 60 * 1000); // cada hora

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
