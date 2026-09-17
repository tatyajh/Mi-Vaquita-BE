import ExpensesService from '../services/expenses.service.js';
import { StatusCodes } from 'http-status-codes';

const expensesService = ExpensesService();

export const getExpensesByGroupController = async (req, res) => {
  try {
    const expenses = await expensesService.getAllByGroup(req.params.groupId);
    res.status(StatusCodes.OK).json(expenses);
  } catch (error) {
    console.error('Failed to get expenses:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};

export const createExpenseController = async (req, res) => {
  const { groupId, paidByUserId, description, amount } = req.body;
  try {
    const expense = await expensesService.create({ groupId, paidByUserId, description, amount });
    res.status(StatusCodes.CREATED).json(expense);
  } catch (error) {
    console.error('Failed to create expense:', error);
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message || 'Internal server error' });
  }
};

export const removeExpenseController = async (req, res) => {
  try {
    await expensesService.remove(req.params.id);
    res.status(StatusCodes.OK).json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Failed to remove expense:', error);
    res.status(StatusCodes.NOT_FOUND).json({ message: error.message || 'Internal server error' });
  }
};

export const getGroupBalancesController = async (req, res) => {
  try {
    const balances = await expensesService.getBalances(req.params.groupId);
    res.status(StatusCodes.OK).json(balances);
  } catch (error) {
    console.error('Failed to get balances:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};
