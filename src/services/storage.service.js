// Sube archivos (hoy solo recibos de gastos) a Supabase Storage vía su
// API HTTP, con `fetch` directo — igual que email.service.js con
// Resend, para no agregar el SDK de supabase-js como dependencia
// nueva solo por esto.
//
// Variables de entorno requeridas:
//   SUPABASE_URL               — URL del proyecto, ej. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  — service role key (NUNCA la anon key:
//                                 esta sube archivos saltándose RLS).
//   SUPABASE_STORAGE_BUCKET    — opcional, por defecto "receipts". El
//                                 bucket debe existir y estar marcado
//                                 como público en el dashboard de
//                                 Supabase (Storage > Buckets) — este
//                                 servicio no lo crea, solo sube.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']);
const MAX_BYTES = 8 * 1024 * 1024;

const isConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const sanitizeFileName = (name) => String(name || 'archivo')
  .toLowerCase()
  .replace(/[^a-z0-9.]+/g, '-')
  .replace(/-+/g, '-')
  .slice(-80);

// Sube un recibo y devuelve su URL pública. Lanza un error con `.code`
// distinguible para que el controller decida el status HTTP correcto
// en vez de que todo termine en un 500 genérico.
export const uploadReceipt = async ({ buffer, mimetype, originalname }, ownerUserId) => {
  if (!isConfigured()) {
    const error = new Error('La subida de recibos no está configurada en el servidor (falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)');
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    const error = new Error('Formato de imagen no soportado. Usa JPG, PNG, WEBP, GIF o HEIC.');
    error.code = 'INVALID_FILE_TYPE';
    throw error;
  }
  if (buffer.length > MAX_BYTES) {
    const error = new Error('La imagen no puede pesar más de 8 MB.');
    error.code = 'FILE_TOO_LARGE';
    throw error;
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'receipts';
  const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  const path = `${ownerUserId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFileName(originalname)}`;

  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mimetype,
      'x-upsert': 'false',
    },
    body: buffer,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Supabase Storage respondió ${response.status}: ${body.slice(0, 300)}`);
    error.code = 'STORAGE_UPLOAD_FAILED';
    throw error;
  }

  return { url: `${baseUrl}/storage/v1/object/public/${bucket}/${path}` };
};

export default { uploadReceipt };
