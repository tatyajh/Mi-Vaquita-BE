import pool from '../lib/connection.js';

const SubscriptionsModel = () => {
  const getByUserIdModel = async (userId) => {
    const result = await pool.query('SELECT * FROM Subscriptions WHERE user_id = $1', [userId]);
    return result.rows[0];
  };

  // upsert por user_id: el webhook de Wompi es la única fuente de
  // verdad para el estado, así que cada evento simplemente reemplaza
  // la fila entera en vez de mezclar campos parciales.
  const upsertSubscriptionModel = async ({ userId, externalReference, externalTransactionId, status, currentPeriodEnd }) => {
    const result = await pool.query(
      `INSERT INTO Subscriptions (user_id, external_reference, external_transaction_id, status, current_period_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         external_reference = EXCLUDED.external_reference,
         external_transaction_id = EXCLUDED.external_transaction_id,
         status = EXCLUDED.status,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()
       RETURNING *`,
      [userId, externalReference, externalTransactionId ?? null, status, currentPeriodEnd ?? null]
    );
    return result.rows[0];
  };

  return {
    getByUserIdModel,
    upsertSubscriptionModel,
  };
};

export default SubscriptionsModel;
