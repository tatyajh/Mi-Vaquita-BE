// src/database/users.model.js
import pool from '../lib/connection.js';

// Todas las funciones de este archivo usan pool.query() directo (no
// pool.connect() + client.release() a mano): pool.query() se encarga
// de pedir y devolver la conexión SIEMPRE, incluso si la consulta
// falla. El patrón anterior (connect/release sin try/finally) dejaba
// la conexión sin liberar cuando una query fallaba, y con suficiente
// tráfico eso agotaba las 15 conexiones que permite el pooler de
// Supabase en modo sesión (error EMAXCONNSESSION) — exactamente lo
// que le pasó a producción.
const UsersModel = () => {

  const getAllUsersModel = async () => {
    const result = await pool.query('SELECT * FROM users WHERE deleted_at IS NULL');
    return result.rows;
  };

  const getByUsersEmailModel = async (email) => {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL', [String(email || '').trim()]);
    return result.rows[0];
  };

  const searchUsersModel = async (query, excludeUserId) => {
    // Excluye al propio usuario autenticado de los resultados: no
    // debe poder encontrarse ni agregarse a sí mismo como amigo.
    const result = await pool.query(
      `SELECT id, name, email FROM users
       WHERE (name ILIKE $1 OR email ILIKE $1)
         AND ($2::int IS NULL OR id != $2)
         AND deleted_at IS NULL
       ORDER BY name ASC LIMIT 10`,
      [`%${query}%`, excludeUserId ?? null]
    );
    return result.rows;
  };

  const getByIdUsersModel = async (id) => {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  };

  const createUsersModel = async (data) => {
    const result = await pool.query(
      'INSERT INTO users (name, email, phone, password, createdAt) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [data.name, String(data.email).trim().toLowerCase(), data.phone, data.password]
    );
    return result.rows[0];
  };

  // Guarda el hash del token de recuperación y su expiración. Se
  // hashea igual que la contraseña (nunca se guarda el token en
  // texto plano) para que una fuga de la base de datos no alcance
  // para resetear contraseñas ajenas.
  //
  // La expiración se calcula con NOW() + INTERVAL de Postgres (no con
  // un `new Date()` calculado en Node y enviado como parámetro):
  // reset_token_expires es un TIMESTAMP sin zona horaria, así que si
  // el valor se calcula en el cliente, node-postgres lo serializa
  // usando la hora LOCAL de esta máquina (America/Bogotá, UTC-5) y
  // Postgres lo guarda tal cual, sin conversión — al compararlo luego
  // contra NOW() (hora del servidor) el token parecía vencido de
  // inmediato. Calculándolo enteramente en el servidor se evita esa
  // discrepancia de zona horaria por completo.
  const setResetTokenModel = async (userId, tokenHash) => {
    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2",
      [tokenHash, userId]
    );
  };

  const getByResetTokenHashModel = async (tokenHash) => {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL`,
      [tokenHash]
    );
    return result.rows[0];
  };

  const updatePasswordModel = async (userId, hashedPassword) => {
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hashedPassword, userId]
    );
    await pool.query('UPDATE UserSessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  };

  const softDeleteUserModel = async (userId) => {
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [userId]);
    await pool.query('UPDATE UserSessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  };

  return {
    getAllUsersModel,
    getByUsersEmailModel,
    searchUsersModel,
    getByIdUsersModel,
    createUsersModel,
    setResetTokenModel,
    getByResetTokenHashModel,
    updatePasswordModel,
    softDeleteUserModel,
  };
};

export default UsersModel;
