// src/database/users.model.js
import pool from '../lib/connection.js';

const UsersModel = () => {

  const getAllUsersModel = async () => {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users WHERE deleted_at IS NULL');
    client.release();
    return result.rows;
  };

  const getByUsersEmailModel = async (email) => {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
    client.release();
    return result.rows[0];
  };

  const searchUsersModel = async (query, excludeUserId) => {
    const client = await pool.connect();
    try {
      // Excluye al propio usuario autenticado de los resultados: no
      // debe poder encontrarse ni agregarse a sí mismo como amigo.
      const result = await client.query(
        `SELECT id, name, email FROM users
         WHERE (name ILIKE $1 OR email ILIKE $1)
           AND ($2::int IS NULL OR id != $2)
           AND deleted_at IS NULL
         ORDER BY name ASC LIMIT 10`,
        [`%${query}%`, excludeUserId ?? null]
      );
      return result.rows;
    } finally {
      client.release();
    }
  };

  const getByIdUsersModel = async (id) => {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    client.release();
    return result.rows[0];
  };

  const createUsersModel = async (data) => {
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO users (name, email, password, createdAt) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [data.name, data.email, data.password]
    );
    client.release();
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
    const client = await pool.connect();
    await client.query(
      "UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2",
      [tokenHash, userId]
    );
    client.release();
  };

  const getByResetTokenHashModel = async (tokenHash) => {
    const client = await pool.connect();
    const result = await client.query(
      `SELECT * FROM users
       WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL`,
      [tokenHash]
    );
    client.release();
    return result.rows[0];
  };

  const updatePasswordModel = async (userId, hashedPassword) => {
    const client = await pool.connect();
    await client.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hashedPassword, userId]
    );
    client.release();
  };

  const softDeleteUserModel = async (userId) => {
    const client = await pool.connect();
    await client.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [userId]);
    client.release();
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
