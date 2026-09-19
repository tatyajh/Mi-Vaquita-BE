import Router from 'express-promise-router';
import { loginController, forgotPasswordController, resetPasswordController } from '../controllers/auth.controller.js';

const router = Router();

router.post('/login', loginController);
router.post('/forgot-password', forgotPasswordController);
router.post('/reset-password', resetPasswordController);

export default router;
