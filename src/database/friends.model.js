import pool from '../lib/connection.js';

const FriendsModel = () => {
  const getAllFriendsModel = async (userId) => {
    const client = await pool.connect();
    // Antes no filtraba por user_id: cualquier usuario logueado veía
    // la lista de amigos de TODOS los usuarios de la app.
    const result = await client.query(
      'SELECT f.id, u.id AS friend_user_id, u.name, u.email FROM friends f JOIN users u ON f.friend_user_id = u.id WHERE f.user_id = $1',
      [userId]
    );
    client.release();
    return result.rows;
  };

  const getByUserIdAndFriendUserId = async (userId, friendUserId) => {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM friends WHERE user_id = $1 AND friend_user_id = $2', [userId, friendUserId]);
    client.release();
    return result.rows[0];
  };

  const createFriendsModel = async (data) => {
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO friends (user_id, friend_user_id) VALUES ($1, $2) RETURNING *',
      [data.userId, data.friendUserId]
    );
    client.release();
    return result.rows[0];
  };

  const deleteFriendsModel = async (id, userId) => {
    const client = await pool.connect();
    const result = await client.query('DELETE FROM friends WHERE id = $1 AND user_id = $2', [id, userId]);
    client.release();
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
