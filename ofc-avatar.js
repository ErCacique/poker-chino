/**
 * ofc-avatar.js — Validación de avatares (predefinidos o subidos).
 */

// Ids de los iconos predefinidos que el cliente puede elegir sin subir nada.
// La lista vive también aquí (no solo en el cliente) para no aceptar un id
// inventado que luego el cliente no sepa renderizar.
export const AVATAR_PRESETS = [
  'spade', 'heart', 'club', 'diamond', 'fox', 'cat', 'owl', 'bear',
];

const MAX_IMAGE_BYTES = 300 * 1024; // tras decodificar el base64
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function validatePreset(id) {
  return AVATAR_PRESETS.includes(id);
}

/**
 * @param {string} dataUrl formato "data:image/png;base64,AAAA..."
 * @returns {{ok:true, mime:string, data:Buffer} | {ok:false, reason:string}}
 */
export function validateAvatarUpload(dataUrl) {
  if (typeof dataUrl !== 'string') return { ok: false, reason: 'Falta la imagen' };
  const match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!match) return { ok: false, reason: 'Formato de imagen no válido' };
  const [, mime, base64] = match;
  if (!ALLOWED_MIME.has(mime)) return { ok: false, reason: 'Solo PNG, JPEG o WebP' };
  let data;
  try {
    data = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, reason: 'Imagen ilegible' };
  }
  if (!data.length || data.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `La imagen debe pesar menos de ${Math.round(MAX_IMAGE_BYTES / 1024)}KB` };
  }
  return { ok: true, mime, data };
}
