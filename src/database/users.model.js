// src/database/users.model.js
import pool from '../lib/connection.js';

const UsersModel = () => {

  const getAllUsersModel = async () => {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users');
    client.release();
    return result.rows;
  };

  const getByUsersEmailModel = async (email) => {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);
    client.release();
    return result.rows[0];
  };

  const searchUsersModel = async (query) => {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, name, email FROM users WHERE name ILIKE $1 OR email ILIKE $1 ORDER BY name ASC LIMIT 10',
      [`%${query}%`]
    );
    client.release();
    return result.rows;
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

  return {
    getAllUsersModel, 
    getByUsersEmailModel,
    searchUsersModel,
    getByIdUsersModel,
    createUsersModel,
  };
};

export default UsersModel;
