import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../lib/connection.js';

const REFRESH_DAYS = 30;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const createAccessToken = (userId) => jwt.sign(
  { id: Number(userId), type: 'access' },
  process.env.JWT_SECRET,
  { expiresIn: '15m' },
);

export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');

export const createSession = async ({ userId, userAgent = null, ipAddress = null }) => {
  const refreshToken = newRefreshToken();
  await pool.query(
    `INSERT INTO UserSessions(user_id,token_hash,expires_at,user_agent,ip_address)
     VALUES($1,$2,NOW()+INTERVAL '30 days',$3,$4)`,
    [userId, hash(refreshToken), String(userAgent || '').slice(0, 300) || null, ipAddress],
  );
  return { accessToken: createAccessToken(userId), refreshToken };
};

export const rotateSession = async (refreshToken, metadata = {}) => {
  if (!refreshToken) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = (await client.query(
      `SELECT s.*,u.deleted_at FROM UserSessions s JOIN Users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() FOR UPDATE`,
      [hash(refreshToken)],
    )).rows[0];
    if (!session || session.deleted_at) {
      await client.query('ROLLBACK');
      return null;
    }
    const replacement = newRefreshToken();
    await client.query(
      `UPDATE UserSessions SET token_hash=$1,last_used_at=NOW(),user_agent=$2,ip_address=$3
       WHERE id=$4`,
      [hash(replacement), String(metadata.userAgent || session.user_agent || '').slice(0, 300) || null, metadata.ipAddress || session.ip_address, session.id],
    );
    await client.query('COMMIT');
    return { accessToken: createAccessToken(session.user_id), refreshToken: replacement };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const revokeSession = async (refreshToken) => {
  if (refreshToken) await pool.query('UPDATE UserSessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL', [hash(refreshToken)]);
};

export const refreshCookie = (token) => {
  const production = process.env.NODE_ENV === 'production';
  return [
    `mv_refresh=${encodeURIComponent(token)}`,
    'Path=/api/auth',
    `Max-Age=${REFRESH_DAYS * 24 * 60 * 60}`,
    'HttpOnly',
    production ? 'Secure' : '',
    production ? 'SameSite=None' : 'SameSite=Lax',
  ].filter(Boolean).join('; ');
};

export const clearRefreshCookie = () => {
  const production = process.env.NODE_ENV === 'production';
  return [
    'mv_refresh=',
    'Path=/api/auth',
    'Max-Age=0',
    'HttpOnly',
    production ? 'Secure' : '',
    production ? 'SameSite=None' : 'SameSite=Lax',
  ].filter(Boolean).join('; ');
};

export const readRefreshCookie = (req) => {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
  return cookies.mv_refresh || null;
};
