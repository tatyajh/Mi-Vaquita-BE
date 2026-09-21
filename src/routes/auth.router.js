import Router from 'express-promise-router';
import { loginController, forgotPasswordController, resetPasswordController, refreshSessionController, logoutController } from '../controllers/auth.controller.js';
import { rateLimit } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.post('/login', rateLimit({ max: 12 }), loginController);
router.post('/refresh', rateLimit({ max: 30 }), refreshSessionController);
router.post('/logout', logoutController);
router.post('/forgot-password', rateLimit({ max: 5 }), forgotPasswordController);
router.post('/reset-password', resetPasswordController);

export default router;
