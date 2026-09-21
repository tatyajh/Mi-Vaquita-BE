import ExpensesService from '../services/expenses.service.js';
import storageService from '../services/storage.service.js';
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

// Sube el archivo del recibo a Supabase Storage. Si no hay
// credenciales configuradas, responde 501 honesto en vez de simular
// un upload exitoso — el gasto se puede seguir creando sin receiptUrl.
export const uploadReceiptController = async (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'No se recibió ningún archivo' });
  }
  try {
    const { url } = await storageService.uploadReceipt(req.file, req.userId);
    res.status(StatusCodes.OK).json({ url });
  } catch (error) {
    if (error.code === 'STORAGE_NOT_CONFIGURED') {
      return res.status(StatusCodes.NOT_IMPLEMENTED).json({ message: error.message, configured: false });
    }
    if (error.code === 'INVALID_FILE_TYPE' || error.code === 'FILE_TOO_LARGE') {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }
    console.error('Failed to upload receipt:', error);
    if (error.code === 'STORAGE_UPLOAD_FAILED') {
      // Muestra el motivo real (bucket inexistente, credenciales
      // inválidas, etc.) en vez de un 500 genérico — esto es
      // configuración del servidor, no un dato inválido del usuario,
      // pero ocultarlo hace imposible diagnosticarlo desde afuera.
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'No se pudo subir el recibo. Intenta de nuevo.' });
  }
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
