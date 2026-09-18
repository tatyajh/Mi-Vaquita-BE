import Router from 'express-promise-router';
import { createUserController, getByIdUsersController, getAllUsersController, getByEmailUsersController, searchUsersController } from '../controllers/users.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.get("/", getAllUsersController);
router.get("/by-email", getByEmailUsersController);
router.get("/search", authenticateJWT, searchUsersController);
router.get("/:id", getByIdUsersController);
router.post('/', createUserController);

export default router;
