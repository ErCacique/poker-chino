import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readVersion() {
  try {
    const configDir = path.dirname(fileURLToPath(import.meta.url));
    const versionFile = path.resolve(configDir, '../version.json');
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    return data.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// VITE_WS_URL apunta al servidor de juego; en desarrollo, ws://localhost:8080.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  define: {
    __APP_VERSION__: JSON.stringify(readVersion()),
  },
});
