import { StatusCodes } from 'http-status-codes';
import billingService from '../services/billing.service.js';

const respondNotConfigured = (res, error) => {
  if (error.code === 'BILLING_NOT_CONFIGURED') {
    res.status(StatusCodes.NOT_IMPLEMENTED).json({ message: error.message, configured: false });
    return true;
  }
  return false;
};

export const createCheckoutController = async (req, res) => {
  try {
    const { url } = await billingService.createCheckoutSession(req.userId);
    res.status(StatusCodes.OK).json({ url });
  } catch (error) {
    if (respondNotConfigured(res, error)) return;
    console.error('Failed to create checkout session:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'No se pudo iniciar el pago. Intenta de nuevo.' });
  }
};

export const getStatusController = async (req, res) => {
  try {
    const status = await billingService.getStatus(req.userId);
    res.status(StatusCodes.OK).json(status);
  } catch (error) {
    console.error('Failed to get billing status:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};

// req.body llega como Buffer crudo (ver billing.router.js /webhook
// montado con express.raw): Stripe firma el body exacto que envía, así
// que si express.json() lo parsea y reserializa primero, la firma ya
// no calza y constructEvent siempre falla.
export const webhookController = async (req, res) => {
  try {
    await billingService.handleWebhookEvent(req.body, req.headers['stripe-signature']);
    res.status(StatusCodes.OK).json({ received: true });
  } catch (error) {
    if (respondNotConfigured(res, error)) return;
    console.error('Stripe webhook signature/processing error:', error.message);
    res.status(StatusCodes.BAD_REQUEST).json({ message: 'Webhook inválido' });
  }
};
