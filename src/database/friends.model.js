import pool from '../lib/connection.js';

// pool.query() en vez de pool.connect()+client.release() a mano: así
// la conexión siempre se devuelve al pool, incluso si la query falla
// (el patrón anterior sin try/finally la dejaba filtrada en ese caso,
// agotando las 15 conexiones que permite Supabase en modo sesión).
const FriendsModel = () => {
  const getAllFriendsModel = async (userId) => {
    // Antes no filtraba por user_id: cualquier usuario logueado veía
    // la lista de amigos de TODOS los usuarios de la app.
    const result = await pool.query(
      `SELECT DISTINCT ON (u.id) f.id, u.id AS friend_user_id, u.name, u.email
       FROM friends f JOIN users u ON f.friend_user_id = u.id
       WHERE f.user_id = $1 AND u.deleted_at IS NULL
       ORDER BY u.id, f.id`,
      [userId]
    );
    return result.rows;
  };

  const getByUserIdAndFriendUserId = async (userId, friendUserId) => {
    const result = await pool.query('SELECT * FROM friends WHERE user_id = $1 AND friend_user_id = $2', [userId, friendUserId]);
    return result.rows[0];
  };

  const createFriendsModel = async (data) => {
    const result = await pool.query(
      'INSERT INTO friends (user_id, friend_user_id) VALUES ($1, $2) RETURNING *',
      [data.userId, data.friendUserId]
    );
    return result.rows[0];
  };

  const deleteFriendsModel = async (id, userId) => {
    const result = await pool.query('DELETE FROM friends WHERE id = $1 AND user_id = $2', [id, userId]);
    return result.rowCount >= 1;
  };

  return {
    getAllFriendsModel,
    getByUserIdAndFriendUserId,
    createFriendsModel,
    deleteFriendsModel,
  };
};

export default FriendsModel;
