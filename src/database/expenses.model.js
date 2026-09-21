import pool from '../lib/connection.js';

const ExpensesModel = () => {
  const getAllByGroupModel = async (groupId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT e.id, e.group_id, e.paid_by_user_id, e.description, e.amount, e.createdat, e.receipt_url,
                e.payment_method, e.category,
                u.name AS paid_by_name, u.email AS paid_by_email
         FROM Expenses e
         JOIN Users u ON e.paid_by_user_id = u.id
         WHERE e.group_id = $1
         ORDER BY e.createdat DESC`,
        [groupId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  };

  const createExpenseModel = async (data) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO Expenses (group_id, paid_by_user_id, description, amount, receipt_url, payment_method, category, createdAt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
        [
          data.groupId,
          data.paidByUserId,
          data.description,
          data.amount,
          data.receiptUrl ?? null,
          data.paymentMethod ?? null,
          data.category ?? null,
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  };

  const deleteExpenseModel = async (id) => {
    const client = await pool.connect();
    try {
      const result = await client.query('DELETE FROM Expenses WHERE id = $1', [id]);
      return result.rowCount >= 1;
    } finally {
      client.release();
    }
  };

  // Para autorizar el borrado: hay que saber a qué grupo pertenece el
  // gasto ANTES de borrarlo, así el service puede confirmar que quien
  // pide borrarlo es miembro de ese grupo.
  const getExpenseByIdModel = async (id) => {
    const result = await pool.query('SELECT id, group_id, paid_by_user_id FROM Expenses WHERE id = $1', [id]);
    return result.rows[0];
  };

  // Miembros de un grupo: el dueño más quienes están en
  // GroupParticipants, sin duplicados. Es contra quién se reparte el
  // gasto — no solo contra los participantes agregados aparte.
  const getGroupMembersModel = async (groupId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT DISTINCT u.id, u.name, u.email FROM Users u
         WHERE u.id IN (
           SELECT ownerUserId FROM Groups WHERE id = $1
           UNION
           SELECT user_id FROM GroupParticipants WHERE group_id = $1
         )`,
        [groupId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  };

  return {
    getAllByGroupModel,
    createExpenseModel,
    deleteExpenseModel,
    getExpenseByIdModel,
    getGroupMembersModel,
  };
};

export default ExpensesModel;
