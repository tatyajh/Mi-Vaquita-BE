import ExpensesService from '../services/expenses.service.js';
import { StatusCodes } from 'http-status-codes';

const expensesService = ExpensesService();

export const getExpensesByGroupController = async (req, res) => {
  try {
    const expenses = await expensesService.getAllByGroup(req.params.groupId, req.userId);
    res.status(StatusCodes.OK).json(expenses);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Failed to get expenses:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};

export const createExpenseController = async (req, res) => {
  const { groupId, paidByUserId, description, amount, receiptUrl, paymentMethod, category } = req.body;
  try {
    const expense = await expensesService.create({ groupId, paidByUserId, description, amount, receiptUrl, paymentMethod, category }, req.userId);
    res.status(StatusCodes.CREATED).json(expense);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Failed to create expense:', error);
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message || 'Internal server error' });
  }
};

// Sube el archivo del recibo a un storage externo (Supabase Storage).
// No hay integración de Supabase Storage en este backend (habla con
// Postgres directo vía `pg`, no con el cliente supabase-js) ni
// credenciales de service role disponibles en este entorno, así que
// devolvemos honestamente "no configurado" en vez de simular un
// upload exitoso. El gasto se puede seguir creando sin receiptUrl.
export const uploadReceiptController = async (req, res) => {
  const isConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!isConfigured) {
    return res.status(StatusCodes.NOT_IMPLEMENTED).json({
      message: 'La subida de recibos no está configurada en el servidor (falta integración de storage / credenciales). El gasto se puede guardar sin foto.',
      configured: false,
    });
  }
  // Punto de extensión: si en el futuro se configuran
  // SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, acá se subiría req.file.buffer
  // al bucket de Supabase Storage y se devolvería la URL pública.
  return res.status(StatusCodes.NOT_IMPLEMENTED).json({
    message: 'Integración de storage detectada pero no implementada todavía.',
    configured: true,
  });
};

export const removeExpenseController = async (req, res) => {
  try {
    await expensesService.remove(req.params.id, req.userId);
    res.status(StatusCodes.OK).json({ message: 'Expense deleted successfully' });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Failed to remove expense:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};

export const getGroupBalancesController = async (req, res) => {
  try {
    const balances = await expensesService.getBalances(req.params.groupId, req.userId);
    res.status(StatusCodes.OK).json(balances);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Failed to get balances:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};

const escapeCsvField = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (rows) => rows.map(row => row.map(escapeCsvField).join(',')).join('\r\n');

// Función Pro: exporta el historial de gastos y los saldos/pagos
// sugeridos de un grupo a CSV (se abre directo en Excel/Sheets). Se
// gatea con requirePro en el router, no acá, para que la decisión de
// qué es Pro quede en un solo lugar (require-pro.middleware.js).
export const exportGroupExpensesController = async (req, res) => {
  try {
    const [expenses, balances] = await Promise.all([
      expensesService.getAllByGroup(req.params.groupId, req.userId),
      expensesService.getBalances(req.params.groupId, req.userId),
    ]);

    const expenseRows = [
      ['Fecha', 'Descripción', 'Pagado por', 'Monto', 'Categoría', 'Medio de pago'],
      ...expenses.map(e => [
        new Date(e.createdat).toLocaleDateString('es-CO'),
        e.description,
        e.paid_by_name,
        e.amount,
        e.category || '',
        e.payment_method || '',
      ]),
      [],
      ['Saldos', `Total: ${balances.total}`, `Por persona: ${balances.share}`],
      ['Nombre', 'Pagó', 'Saldo'],
      ...balances.balances.map(b => [b.name, b.paid, b.balance]),
      [],
      ['Pagos sugeridos'],
      ['De', 'A', 'Monto'],
      ...balances.settlements.map(s => [s.from.name, s.to.name, s.amount]),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="grupo-${req.params.groupId}-gastos.csv"`);
    res.status(StatusCodes.OK).send(toCsv(expenseRows));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Failed to export group expenses:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};
