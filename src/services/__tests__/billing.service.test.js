import { jest } from '@jest/globals';
import crypto from 'crypto';

// La lógica más delicada de billing.service.js (Wompi, no Stripe: ver
// el comentario al inicio de ese archivo) es la firma de integridad
// del checkout y la verificación del checksum del webhook — si
// cualquiera de las dos queda mal, o nunca se activa el plan Pro, o
// peor, cualquiera podría falsificar un webhook y activarlo gratis.
const upsertSubscriptionModel = jest.fn();
const getByUserIdModel = jest.fn();

jest.unstable_mockModule('../../database/subscriptions.model.js', () => ({
  default: () => ({ getByUserIdModel, upsertSubscriptionModel }),
}));

const { default: billingService } = await import('../billing.service.js');

const ENV = {
  WOMPI_PUBLIC_KEY: 'pub_test_123',
  WOMPI_INTEGRITY_SECRET: 'integrity_secret_abc',
  WOMPI_EVENTS_SECRET: 'events_secret_xyz',
  WOMPI_PRICE_COP: '4900',
  FRONTEND_URL: 'https://mi-vaquita-fe.vercel.app',
};

describe('billing.service createCheckoutSession', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, ...ENV }; });
  afterEach(() => { process.env = originalEnv; });

  it('throws BILLING_NOT_CONFIGURED when a required env var is missing', async () => {
    delete process.env.WOMPI_INTEGRITY_SECRET;
    await expect(billingService.createCheckoutSession(1)).rejects.toMatchObject({ code: 'BILLING_NOT_CONFIGURED' });
  });

  it('builds a checkout URL with a reference and a signature matching Wompi\'s formula', async () => {
    const { url } = await billingService.createCheckoutSession(42);
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://checkout.wompi.co/p/');
    expect(parsed.searchParams.get('public-key')).toBe('pub_test_123');
    expect(parsed.searchParams.get('amount-in-cents')).toBe('490000');
    expect(parsed.searchParams.get('reference')).toMatch(/^mivaquita-pro-42-\d+$/);

    const reference = parsed.searchParams.get('reference');
    const expectedSignature = crypto
      .createHash('sha256')
      .update(`${reference}490000COP${ENV.WOMPI_INTEGRITY_SECRET}`)
      .digest('hex');
    expect(parsed.searchParams.get('signature:integrity')).toBe(expectedSignature);
  });
});

describe('billing.service.handleWebhookEvent', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, WOMPI_EVENTS_SECRET: ENV.WOMPI_EVENTS_SECRET };
    upsertSubscriptionModel.mockClear();
  });
  afterEach(() => { process.env = originalEnv; });

  const buildEvent = (transaction, timestamp = 1700000000) => {
    const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
    const values = properties.map(p => p.split('.').reduce((o, k) => o[k], { transaction }));
    const checksum = crypto
      .createHash('sha256')
      .update(`${values.join('')}${timestamp}${ENV.WOMPI_EVENTS_SECRET}`)
      .digest('hex');
    return {
      event: 'transaction.updated',
      data: { transaction },
      timestamp,
      signature: { properties, checksum },
    };
  };

  it('activates the subscription for an approved transaction with a valid checksum', async () => {
    const event = buildEvent({
      id: 'wompi-tx-1',
      status: 'APPROVED',
      amount_in_cents: 490000,
      reference: 'mivaquita-pro-7-1699999999999',
    });

    await billingService.handleWebhookEvent(event);

    expect(upsertSubscriptionModel).toHaveBeenCalledTimes(1);
    const call = upsertSubscriptionModel.mock.calls[0][0];
    expect(call.userId).toBe(7);
    expect(call.status).toBe('active');
    expect(call.externalTransactionId).toBe('wompi-tx-1');
    expect(call.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an event whose checksum does not match', async () => {
    const event = buildEvent({
      id: 'wompi-tx-2',
      status: 'APPROVED',
      amount_in_cents: 490000,
      reference: 'mivaquita-pro-7-1699999999999',
    });
    event.signature.checksum = 'tampered';

    await expect(billingService.handleWebhookEvent(event)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    expect(upsertSubscriptionModel).not.toHaveBeenCalled();
  });

  it('does not activate the plan for a declined transaction', async () => {
    const event = buildEvent({
      id: 'wompi-tx-3',
      status: 'DECLINED',
      amount_in_cents: 490000,
      reference: 'mivaquita-pro-7-1699999999999',
    });

    await billingService.handleWebhookEvent(event);

    expect(upsertSubscriptionModel).not.toHaveBeenCalled();
  });
});
