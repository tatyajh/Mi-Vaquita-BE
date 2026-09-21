import pool from '../lib/connection.js';

const SubscriptionsModel = () => {
  const getByUserIdModel = async (userId) => {
    const result = await pool.query('SELECT * FROM Subscriptions WHERE user_id = $1', [userId]);
    return result.rows[0];
  };

  const getByStripeCustomerIdModel = async (stripeCustomerId) => {
    const result = await pool.query('SELECT * FROM Subscriptions WHERE stripe_customer_id = $1', [stripeCustomerId]);
    return result.rows[0];
  };

  // upsert por user_id: el webhook de Stripe es la única fuente de
  // verdad para el estado, así que cada evento simplemente reemplaza
  // la fila entera en vez de mezclar campos parciales.
  const upsertSubscriptionModel = async ({ userId, stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd }) => {
    const result = await pool.query(
      `INSERT INTO Subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         status = EXCLUDED.status,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()
       RETURNING *`,
      [userId, stripeCustomerId, stripeSubscriptionId ?? null, status, currentPeriodEnd ?? null]
    );
    return result.rows[0];
  };

  return {
    getByUserIdModel,
    getByStripeCustomerIdModel,
    upsertSubscriptionModel,
  };
};

export default SubscriptionsModel;
