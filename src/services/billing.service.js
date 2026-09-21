// Suscripción Pro vía Stripe Checkout. La app nunca ve ni guarda
// números de tarjeta: Stripe aloja el formulario de pago y solo nos
// avisa por webhook cuándo un usuario queda activo/vencido.
//
// Variables de entorno requeridas:
//   STRIPE_SECRET_KEY     — clave secreta de la cuenta de Stripe.
//   STRIPE_PRICE_ID       — id del price recurrente ("Mi Vaquita Pro").
//   STRIPE_WEBHOOK_SECRET — firma del webhook, para verificar que el
//                            evento viene realmente de Stripe.
//   FRONTEND_URL          — para armar success_url/cancel_url.
//
// Si STRIPE_SECRET_KEY no está configurada, se lanza un error claro en
// vez de fallar de forma críptica — igual que email.service.js con
// Resend.
import Stripe from 'stripe';
import UsersModel from '../database/users.model.js';
import SubscriptionsModel from '../database/subscriptions.model.js';

const subscriptionsModel = SubscriptionsModel();
const usersModel = UsersModel();

let stripeClient = null;
const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    const error = new Error('La facturación no está configurada en el servidor (falta STRIPE_SECRET_KEY)');
    error.code = 'BILLING_NOT_CONFIGURED';
    throw error;
  }
  if (!stripeClient) stripeClient = new Stripe(secretKey);
  return stripeClient;
};

// Son las que Stripe reporta mientras el usuario debe seguir teniendo
// acceso Pro; cualquier otro estado (canceled, unpaid, past_due...) no
// cuenta como Pro vigente.
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

const createCheckoutSession = async (userId) => {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    const error = new Error('La facturación no está configurada en el servidor (falta STRIPE_PRICE_ID)');
    error.code = 'BILLING_NOT_CONFIGURED';
    throw error;
  }

  const user = await usersModel.getByIdUsersModel(userId);
  const existing = await subscriptionsModel.getByUserIdModel(userId);
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: existing?.stripe_customer_id,
    customer_email: existing?.stripe_customer_id ? undefined : user.email,
    client_reference_id: String(userId),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${frontendUrl}/precios?checkout=success`,
    cancel_url: `${frontendUrl}/precios?checkout=cancel`,
  });

  return { url: session.url };
};

const getStatus = async (userId) => {
  const subscription = await subscriptionsModel.getByUserIdModel(userId);
  const isPro = Boolean(subscription && ACTIVE_STATUSES.has(subscription.status));
  return {
    isPro,
    status: subscription?.status ?? 'none',
    currentPeriodEnd: subscription?.current_period_end ?? null,
  };
};

const isUserPro = async (userId) => {
  const subscription = await subscriptionsModel.getByUserIdModel(userId);
  return Boolean(subscription && ACTIVE_STATUSES.has(subscription.status));
};

// Un solo Checkout Session trae al usuario que la inició
// (client_reference_id) y al Customer que Stripe crea/reutiliza; con
// eso alcanza para la primera fila. Las actualizaciones posteriores
// (renovación, cancelación) llegan como customer.subscription.* y ya
// no traen client_reference_id, por eso se buscan por
// stripe_customer_id en vez de asumir que siempre viene el userId.
const upsertFromSubscriptionObject = async (subscriptionObject, userId) => {
  const resolvedUserId = userId
    ?? (await subscriptionsModel.getByStripeCustomerIdModel(subscriptionObject.customer))?.user_id;
  if (!resolvedUserId) return;

  const periodEndSeconds = subscriptionObject.current_period_end;
  await subscriptionsModel.upsertSubscriptionModel({
    userId: resolvedUserId,
    stripeCustomerId: subscriptionObject.customer,
    stripeSubscriptionId: subscriptionObject.id,
    status: subscriptionObject.status,
    currentPeriodEnd: periodEndSeconds ? new Date(periodEndSeconds * 1000) : null,
  });
};

const handleWebhookEvent = async (rawBody, signature) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    const error = new Error('La facturación no está configurada en el servidor (falta STRIPE_WEBHOOK_SECRET)');
    error.code = 'BILLING_NOT_CONFIGURED';
    throw error;
  }
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') break;
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await upsertFromSubscriptionObject(subscription, Number(session.client_reference_id) || undefined);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await upsertFromSubscriptionObject(event.data.object);
      break;
    }
    default:
      break;
  }

  return { received: true };
};

export default { createCheckoutSession, getStatus, isUserPro, handleWebhookEvent };
