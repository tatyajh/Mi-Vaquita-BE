import Router from 'express-promise-router';
import {
  createUserController,
  getByIdUsersController,
  getAllUsersController,
  getByEmailUsersController,
  searchUsersController,
  changePasswordController,
  deactivateAccountController,
} from '../controllers/users.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.get("/", getAllUsersController);
router.get("/by-email", getByEmailUsersController);
router.get("/search", authenticateJWT, searchUsersController);
router.put('/me/password', authenticateJWT, changePasswordController);
router.delete('/me', authenticateJWT, deactivateAccountController);
router.get("/:id", getByIdUsersController);
router.post('/', rateLimit({ max: 10 }), createUserController);

export default router;
