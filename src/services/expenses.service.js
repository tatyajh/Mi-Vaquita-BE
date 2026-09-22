import ExpensesModel from '../database/expenses.model.js';
import GroupsModel from '../database/groups.model.js';

// Antes ninguna de estas funciones verificaba que quien pregunta sea
// parte del grupo: cualquier usuario logueado podía leer los gastos y
// saldos de CUALQUIER grupo, o registrar/borrar gastos en un grupo
// ajeno, con solo saber (o adivinar) el groupId. "No existe" en vez de
// "no autorizado" para no filtrar qué ids de grupo son válidos.
const notFound = (message) => { const error = new Error(message); error.statusCode = 404; return error; };

const ExpensesService = () => {
  const expensesModel = ExpensesModel();
  const groupsModel = GroupsModel();

  const assertGroupMember = async (groupId, userId) => {
    const { isMember } = await groupsModel.getMembershipModel(groupId, userId);
    if (!isMember) {
      throw notFound(`Group with id ${groupId} does not exist`);
    }
  };

  const getAllByGroup = async (groupId, requesterUserId) => {
    await assertGroupMember(groupId, requesterUserId);
    return expensesModel.getAllByGroupModel(groupId);
  };

  // Un usuario registrado solo puede anotar gastos que ÉL mismo pagó —
  // no puede atribuirle el pago a otro miembro registrado sin su
  // consentimiento. Si quien pagó de verdad no quiere registrarse,
  // paidByName guarda su nombre en vez de un id de usuario.
  const create = async ({ groupId, paidByUserId, paidByName, description, amount, receiptUrl, paymentMethod, category }, requesterUserId) => {
    if (!description || !description.trim()) {
      throw new Error('La descripción es obligatoria');
    }
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      throw new Error('El monto debe ser mayor a cero');
    }
    await assertGroupMember(groupId, requesterUserId);

    const trimmedName = paidByName?.trim();
    let payerUserId = null;
    let payerName = null;
    if (trimmedName) {
      payerName = trimmedName;
    } else if (String(paidByUserId) === String(requesterUserId)) {
      payerUserId = requesterUserId;
    } else {
      throw new Error('Solo puedes registrar gastos que tú mismo pagaste. Si pagó otra persona que no está registrada, escribe su nombre.');
    }

    return expensesModel.createExpenseModel({
      groupId,
      paidByUserId: payerUserId,
      paidByName: payerName,
      description: description.trim(),
      amount: parsedAmount,
      receiptUrl: receiptUrl || null,
      paymentMethod: paymentMethod || null,
      category: category || null,
    });
  };

  const remove = async (id, requesterUserId) => {
    const expense = await expensesModel.getExpenseByIdModel(id);
    if (!expense) {
      throw notFound(`Expense with id ${id} does not exist`);
    }
    await assertGroupMember(expense.group_id, requesterUserId);
    const deleted = await expensesModel.deleteExpenseModel(id);
    if (!deleted) {
      throw notFound(`Expense with id ${id} does not exist`);
    }
    return deleted;
  };

  // Reparto en partes iguales entre los miembros del grupo. El saldo
  // de cada quien es lo que pagó menos lo que le tocaba pagar; con
  // eso arma quién le debe a quién con el menor número de pagos
  // posible (algoritmo greedy: el que más debe le paga al que más le
  // deben, y así hasta que todos quedan en cero).
  const getBalances = async (groupId, requesterUserId) => {
    await assertGroupMember(groupId, requesterUserId);
    const [members, expenses] = await Promise.all([
      expensesModel.getGroupMembersModel(groupId),
      expensesModel.getAllByGroupModel(groupId),
    ]);

    const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const totalCents = Math.round(total * 100);
    const memberCount = members.length;
    const share = memberCount > 0 ? total / memberCount : 0;

    // $100 entre 3 no es $33.33 exactos (33.33×3 = 99.99, falta un
    // centavo): redondear la misma "share" para cada miembro dejaba a
    // quien pagó recibiendo un centavo menos de lo real (los saldos no
    // sumaban exactamente cero). Se reparte el total en centavos
    // enteros y el sobrante (siempre < memberCount centavos) se le
    // asigna a los primeros miembros del grupo, así la suma de las
    // partes es EXACTAMENTE el total.
    const baseShareCents = memberCount > 0 ? Math.floor(totalCents / memberCount) : 0;
    const remainderCents = memberCount > 0 ? totalCents - baseShareCents * memberCount : 0;
    const shareCentsByMember = new Map(members.map((m, i) => [m.id, baseShareCents + (i < remainderCents ? 1 : 0)]));

    const paidByMember = new Map(members.map(m => [m.id, 0]));
    for (const expense of expenses) {
      const current = paidByMember.get(expense.paid_by_user_id) ?? 0;
      paidByMember.set(expense.paid_by_user_id, current + Number(expense.amount));
    }

    const balances = members.map(member => {
      const paidCents = Math.round((paidByMember.get(member.id) ?? 0) * 100);
      const shareCents = shareCentsByMember.get(member.id) ?? 0;
      return {
        userId: member.id,
        name: member.name,
        email: member.email,
        paid: paidCents / 100,
        balance: (paidCents - shareCents) / 100,
      };
    });

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
