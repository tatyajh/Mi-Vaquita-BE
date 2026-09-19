import Router from 'express-promise-router';
import multer from 'multer';
import {
  getExpensesByGroupController,
  createExpenseController,
  removeExpenseController,
  getGroupBalancesController,
  uploadReceiptController,
} from '../controllers/expenses.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.use(authenticateJWT);

router.get('/group/:groupId', getExpensesByGroupController);
router.get('/group/:groupId/balances', getGroupBalancesController);
router.post('/', createExpenseController);
router.post('/upload-receipt', upload.single('receipt'), uploadReceiptController);
router.delete('/:id', removeExpenseController);

export default router;
