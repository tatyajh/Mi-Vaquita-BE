import { jest } from '@jest/globals';

// getBalances/settleUp son la lógica de negocio más sensible del backend
// (deciden quién le debe a quién): antes de este test no tenían ninguna
// cobertura. Se mockea el modelo (habla con Postgres real) para poder
// probar el cálculo en aislamiento con datos fijos.
const members = [
  { id: 1, name: 'Ana', email: 'ana@test.com' },
  { id: 2, name: 'Beto', email: 'beto@test.com' },
  { id: 3, name: 'Caro', email: 'caro@test.com' },
];

const getGroupMembersModel = jest.fn(async () => members);
const getAllByGroupModel = jest.fn();

jest.unstable_mockModule('../../database/expenses.model.js', () => ({
  default: () => ({
    getAllByGroupModel,
    createExpenseModel: jest.fn(),
    deleteExpenseModel: jest.fn(),
    getGroupMembersModel,
  }),
}));

const { default: ExpensesService } = await import('../expenses.service.js');
const expensesService = ExpensesService();

describe('expenses.service getBalances/settleUp', () => {
  it('splits a single expense evenly between two members and produces one settlement', async () => {
    getGroupMembersModel.mockResolvedValueOnce(members.slice(0, 2));
    getAllByGroupModel.mockResolvedValueOnce([
      { paid_by_user_id: 1, amount: '100.00' },
    ]);

    const result = await expensesService.getBalances(1);

    expect(result.total).toBe(100);
    expect(result.share).toBe(50);
    expect(result.settlements).toEqual([
      { from: { userId: 2, name: 'Beto' }, to: { userId: 1, name: 'Ana' }, amount: 50 },
    ]);
  });

  it('produces the minimum number of settlements for three members with uneven payments', async () => {
    getAllByGroupModel.mockResolvedValueOnce([
      { paid_by_user_id: 1, amount: '90.00' },
      { paid_by_user_id: 2, amount: '0.00' },
    ]);

    const result = await expensesService.getBalances(1);

    // Total 90 entre 3 = 30 c/u. Ana pagó 90 (le deben 60), Beto y Caro
    // pagaron 0 (deben 30 cada uno) -> 2 pagos, no 3.
    expect(result.share).toBe(30);
    expect(result.settlements).toHaveLength(2);
    const totalSettled = result.settlements.reduce((sum, s) => sum + s.amount, 0);
    expect(totalSettled).toBe(60);
    expect(result.settlements.every(s => s.to.userId === 1)).toBe(true);
  });

  it('rounds amounts that do not divide evenly without leaving unsettled cents', async () => {
    getAllByGroupModel.mockResolvedValueOnce([
      { paid_by_user_id: 1, amount: '100.00' },
    ]);

    const result = await expensesService.getBalances(1);

    // 100 / 3 = 33.33... -> share se redondea a 33.33, y las
    // liquidaciones deben seguir sumando (casi) el total repartido.
    expect(result.share).toBeCloseTo(33.33, 2);
    const totalSettled = result.settlements.reduce((sum, s) => sum + s.amount, 0);
    expect(totalSettled).toBeCloseTo(66.66, 1);
  });

  it('produces no settlements when there are no expenses', async () => {
    getAllByGroupModel.mockResolvedValueOnce([]);

    const result = await expensesService.getBalances(1);

    expect(result.total).toBe(0);
    expect(result.settlements).toEqual([]);
  });
});
