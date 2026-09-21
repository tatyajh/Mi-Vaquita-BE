// Suscripción Pro vía Wompi (pasarela colombiana de Bancolombia).
// Stripe no acepta cuentas de comercio colombianas sin registrar una
// empresa en el exterior, así que se usa Wompi en su lugar.
//
// A diferencia de Stripe, Wompi no tiene un objeto "suscripción": cada
// pago es una transacción suelta contra su Web Checkout (hosteado por
// Wompi — la app nunca ve el número de tarjeta). Por eso el modelo
// aquí es "un pago activa/renueva 30 días de Pro", no una suscripción
// que se cobra sola cada mes; el usuario vuelve a pagar cuando le
// avisamos que está por vencerse. Cobro automático recurrente (tarjeta
// tokenizada + recargo mensual sin intervención) queda como mejora
// futura documentada, no a medio implementar aquí.
//
// Variables de entorno requeridas:
//   WOMPI_PUBLIC_KEY      — clave pública del comercio en Wompi.
//   WOMPI_INTEGRITY_SECRET — secreto de integridad, para firmar cada
//                             checkout (Ajustes > Secretos, en el
//                             dashboard de Wompi).
//   WOMPI_EVENTS_SECRET    — secreto de eventos, para verificar que un
//                             webhook realmente viene de Wompi.
//   WOMPI_PRICE_COP        — precio mensual de Pro en pesos (sin
//                             centavos), ej. 4900.
//   FRONTEND_URL           — para armar la URL de retorno tras pagar.
import crypto from 'crypto';
import SubscriptionsModel from '../database/subscriptions.model.js';

const subscriptionsModel = SubscriptionsModel();

const WOMPI_CHECKOUT_URL = 'https://checkout.wompi.co/p/';
const PLAN_DURATION_DAYS = 30;
const ACTIVE_STATUSES = new Set(['active']);

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`La facturación no está configurada en el servidor (falta ${name})`);
    error.code = 'BILLING_NOT_CONFIGURED';
    throw error;
  }
  return value;
};

// El userId va codificado en la referencia (no hay "cliente" en Wompi
// que lo cargue por nosotros); se recupera al procesar el webhook.
const buildReference = (userId) => `mivaquita-pro-${userId}-${Date.now()}`;
const parseUserIdFromReference = (reference) => {
  const match = /^mivaquita-pro-(\d+)-\d+$/.exec(reference || '');
  return match ? Number(match[1]) : null;
};

const createCheckoutSession = async (userId) => {
  const publicKey = requireEnv('WOMPI_PUBLIC_KEY');
  const integritySecret = requireEnv('WOMPI_INTEGRITY_SECRET');
  const priceCop = Number(requireEnv('WOMPI_PRICE_COP'));
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

  const reference = buildReference(userId);
  const amountInCents = Math.round(priceCop * 100);
  const currency = 'COP';
  // Firma de integridad exigida por Wompi: sha256("<reference><amount><currency><secreto>").
  const signature = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${integritySecret}`)
    .digest('hex');

  const params = new URLSearchParams({
    'public-key': publicKey,
    currency,
    'amount-in-cents': String(amountInCents),
    reference,
    'signature:integrity': signature,
    'redirect-url': `${frontendUrl}/precios?checkout=return`,
  });

  return { url: `${WOMPI_CHECKOUT_URL}?${params.toString()}` };
};

const getStatus = async (userId) => {
  const subscription = await subscriptionsModel.getByUserIdModel(userId);
  const isPro = Boolean(
    subscription
    && ACTIVE_STATUSES.has(subscription.status)
    && subscription.current_period_end
    && new Date(subscription.current_period_end) > new Date()
  );
  return {
    isPro,
    status: subscription?.status ?? 'none',
    currentPeriodEnd: subscription?.current_period_end ?? null,
  };
};

const isUserPro = async (userId) => {
  const { isPro } = await getStatus(userId);
  return isPro;
};

// Recorre signature.properties (ej. ["transaction.id","transaction.status","transaction.amount_in_cents"]),
// toma cada valor del payload por esa ruta ("transaction.id" -> data.transaction.id),
// y concatena: valores + timestamp del evento + secreto de eventos.
const computeChecksum = (event, eventsSecret) => {
  const values = (event.signature?.properties || []).map((path) => {
    const keys = path.split('.');
    return keys.reduce((node, key) => node?.[key], event.data);
  });
  const raw = `${values.join('')}${event.timestamp}${eventsSecret}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

const handleWebhookEvent = async (event) => {
  const eventsSecret = requireEnv('WOMPI_EVENTS_SECRET');

  const expectedChecksum = computeChecksum(event, eventsSecret);
  const receivedChecksum = String(event.signature?.checksum || '');
  if (expectedChecksum.toLowerCase() !== receivedChecksum.toLowerCase()) {
    const error = new Error('Firma de webhook inválida');
    error.code = 'INVALID_SIGNATURE';
    throw error;
  }

  if (event.event !== 'transaction.updated') return { received: true };

  const transaction = event.data.transaction;
  const userId = parseUserIdFromReference(transaction.reference);
  if (!userId) return { received: true };

  if (transaction.status !== 'APPROVED') {
    // No pisa una suscripción activa por un intento fallido/duplicado;
    // solo registra el pago aprobado.
    return { received: true };
  }

  // Wompi reintenta el mismo evento hasta 3 veces si no respondemos
  // 200 a tiempo, y un evento capturado (logs/dashboard) se podría
  // reenviar manualmente después — sin este chequeo, cualquiera de los
  // dos casos volvía a correr los 30 días desde "ahora", extendiendo
  // el plan Pro indefinidamente a partir de un solo pago real.
  const existing = await subscriptionsModel.getByUserIdModel(userId);
  if (existing?.external_transaction_id === String(transaction.id)) {
    return { received: true };
  }

  const currentPeriodEnd = new Date(Date.now() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);
  await subscriptionsModel.upsertSubscriptionModel({
    userId,
    externalReference: transaction.reference,
    externalTransactionId: transaction.id,
    status: 'active',
    currentPeriodEnd,
  });

  return { received: true };
};

export default { createCheckoutSession, getStatus, isUserPro, handleWebhookEvent };
