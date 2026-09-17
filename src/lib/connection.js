import { config } from 'dotenv';
import pg from 'pg';

const { Pool } = pg;
// `path: '../.env'` resolvía un directorio arriba del cwd del
// proceso (nunca donde vive el .env real), así que dotenv nunca
// cargaba nada — funcionaba "por accidente" con un Postgres local
// sin password. Supabase sí necesita estas variables.
config();

// Supabase exige SSL en la conexión directa a Postgres.
const pool = new Pool({
  ssl: { rejectUnauthorized: false },
});

export default pool;
