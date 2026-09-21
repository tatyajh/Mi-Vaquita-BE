import Router from 'express-promise-router';
import { loginController, forgotPasswordController, resetPasswordController } from '../controllers/auth.controller.js';
import { rateLimit } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.post('/login', rateLimit({ max: 12 }), loginController);
router.post('/forgot-password', rateLimit({ max: 5 }), forgotPasswordController);
router.post('/reset-password', resetPasswordController);

export default router;
