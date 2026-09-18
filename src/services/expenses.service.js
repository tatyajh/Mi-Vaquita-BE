import ExpensesModel from '../database/expenses.model.js';

const ExpensesService = () => {
  const expensesModel = ExpensesModel();

  const getAllByGroup = async (groupId) => {
    return expensesModel.getAllByGroupModel(groupId);
  };

  const create = async ({ groupId, paidByUserId, description, amount, receiptUrl, paymentMethod, category }) => {
    if (!description || !description.trim()) {
      throw new Error('La descripción es obligatoria');
    }
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      throw new Error('El monto debe ser mayor a cero');
    }
    return expensesModel.createExpenseModel({
      groupId,
      paidByUserId,
      description: description.trim(),
      amount: parsedAmount,
      receiptUrl: receiptUrl || null,
      paymentMethod: paymentMethod || null,
      category: category || null,
    });
  };

  const remove = async (id) => {
    const deleted = await expensesModel.deleteExpenseModel(id);
    if (!deleted) {
      throw new Error(`Expense with id ${id} does not exist`);
    }
    return deleted;
  };

  // Reparto en partes iguales entre los miembros del grupo. El saldo
  // de cada quien es lo que pagó menos lo que le tocaba pagar; con
  // eso arma quién le debe a quién con el menor número de pagos
  // posible (algoritmo greedy: el que más debe le paga al que más le
  // deben, y así hasta que todos quedan en cero).
  const getBalances = async (groupId) => {
    const [members, expenses] = await Promise.all([
      expensesModel.getGroupMembersModel(groupId),
      expensesModel.getAllByGroupModel(groupId),
    ]);

    const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const share = members.length > 0 ? total / members.length : 0;

    const paidByMember = new Map(members.map(m => [m.id, 0]));
    for (const expense of expenses) {
      const current = paidByMember.get(expense.paid_by_user_id) ?? 0;
      paidByMember.set(expense.paid_by_user_id, current + Number(expense.amount));
    }

    const balances = members.map(member => ({
      userId: member.id,
      name: member.name,
      email: member.email,
      paid: Math.round((paidByMember.get(member.id) ?? 0) * 100) / 100,
      balance: Math.round(((paidByMember.get(member.id) ?? 0) - share) * 100) / 100,
    }));

    const settlements = settleUp(balances);

    return { total: Math.round(total * 100) / 100, share: Math.round(share * 100) / 100, balances, settlements };
  };

  return {
    getAllByGroup,
    create,
    remove,
    getBalances,
  };
};

function settleUp(balances) {
  const debtors = balances
    .filter(b => b.balance < -0.01)
    .map(b => ({ ...b, remaining: -b.balance }))
    .sort((a, b) => b.remaining - a.remaining);
  const creditors = balances
    .filter(b => b.balance > 0.01)
    .map(b => ({ ...b, remaining: b.balance }))
    .sort((a, b) => b.remaining - a.remaining);

  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.round(Math.min(debtor.remaining, creditor.remaining) * 100) / 100;

    if (amount > 0) {
      settlements.push({
        from: { userId: debtor.userId, name: debtor.name },
        to: { userId: creditor.userId, name: creditor.name },
        amount,
      });
    }

    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining <= 0.01) i += 1;
    if (creditor.remaining <= 0.01) j += 1;
  }

  return settlements;
}

export default ExpensesService;
