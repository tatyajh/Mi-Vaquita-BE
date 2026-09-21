import Router from 'express-promise-router';
import { createCheckoutController, getStatusController, webhookController } from '../controllers/billing.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = Router();

// Pública: Wompi la llama directamente, sin JWT de ningún usuario.
router.post('/webhook', webhookController);

router.post('/checkout', authenticateJWT, createCheckoutController);
router.get('/status', authenticateJWT, getStatusController);

export default router;
