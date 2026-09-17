import Router from 'express-promise-router';
import {
  getExpensesByGroupController,
  createExpenseController,
  removeExpenseController,
  getGroupBalancesController,
} from '../controllers/expenses.controller.js';

const router = Router();

router.get('/group/:groupId', getExpensesByGroupController);
router.get('/group/:groupId/balances', getGroupBalancesController);
router.post('/', createExpenseController);
router.delete('/:id', removeExpenseController);

export default router;
