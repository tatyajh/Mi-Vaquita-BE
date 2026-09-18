import pool from '../lib/connection.js';

const FriendsModel = () => {
  const getAllFriendsModel = async () => {
    const client = await pool.connect();
    const result = await client.query('SELECT f.id, u.name, u.email FROM friends f JOIN users u ON f.friend_user_id = u.id');
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

  const deleteFriendsModel = async (id) => {
    const client = await pool.connect();
    const result = await client.query('DELETE FROM friends WHERE id = $1', [id]);
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
