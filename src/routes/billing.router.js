import Router from 'express-promise-router';
import { createCheckoutController, getStatusController } from '../controllers/billing.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticateJWT);

router.post('/checkout', createCheckoutController);
router.get('/status', getStatusController);

export default router;
