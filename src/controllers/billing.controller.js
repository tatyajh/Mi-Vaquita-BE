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

// Wompi firma sobre valores puntuales del JSON (ver signature.properties
// en billing.service.js), no sobre el byte-string crudo del body como
// Stripe — así que a diferencia de Stripe, este endpoint puede vivir
// detrás del express.json() normal de app.js sin problema.
export const webhookController = async (req, res) => {
  try {
    await billingService.handleWebhookEvent(req.body);
    res.status(StatusCodes.OK).json({ received: true });
  } catch (error) {
    if (respondNotConfigured(res, error)) return;
    console.error('Wompi webhook signature/processing error:', error.message);
    res.status(StatusCodes.BAD_REQUEST).json({ message: 'Webhook inválido' });
  }
};
