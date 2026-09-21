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

// Ninguno de estos tenía authenticateJWT: cualquiera, sin iniciar
// sesión, podía pedir GET /api/users y descargar el directorio
// completo (nombre, correo, teléfono) de todos los usuarios de la
// app — un reporte externo (auditoría de Codex) lo confirmó en vivo.
router.get("/", authenticateJWT, getAllUsersController);
router.get("/by-email", authenticateJWT, getByEmailUsersController);
router.get("/search", authenticateJWT, searchUsersController);
router.put('/me/password', authenticateJWT, changePasswordController);
router.delete('/me', authenticateJWT, deactivateAccountController);
router.get("/:id", authenticateJWT, getByIdUsersController);
router.post('/', rateLimit({ max: 10 }), createUserController);

export default router;
