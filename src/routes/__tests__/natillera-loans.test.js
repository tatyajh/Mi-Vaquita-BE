import { loanProgress } from '../natilleras.router.js';

// El interés de los préstamos de natillera se calcula sobre el saldo
// real y el tiempo real transcurrido (no un total fijo calculado al
// prestar): pagar antes debe cobrar menos interés, y un préstamo que
// se alarga debe seguir acumulando interés real por el tiempo de más,
// en vez de quedar "gratis" pasado el plazo planeado.
//
// loanProgress ancla "today" a mediodía UTC (evita el corrimiento de
// un día por zona horaria); issued_on/created_at de los fixtures acá
// también se fijan a mediodía UTC para que los días transcurridos den
// números enteros exactos y las cuentas de este archivo sean
// verificables a mano.
describe('loanProgress (interés sobre saldo real)', () => {
  const loan = { principal: 1000000, annual_rate: 12, interest: 0, issued_on: '2026-01-01T12:00:00Z' };

  it('no acumula interés el mismo día que se presta', () => {
    const progress = loanProgress(loan, [], '2026-01-01');
    expect(progress.interestPending).toBe(0);
    expect(progress.capitalPending).toBe(1000000);
  });

  it('acumula interés proporcional a los días transcurridos sin abonos', () => {
    // 1.000.000 al 12% anual, 30 días: 1000000 * 0.12 * (30/365) ≈ 9863.01
    const progress = loanProgress(loan, [], '2026-01-31');
    expect(progress.interestPending).toBeCloseTo(9863.01, 1);
  });

  it('pagar antes acumula menos interés que dejar pasar el plazo completo', () => {
    const early = loanProgress(loan, [], '2026-01-10'); // 9 días
    const late = loanProgress(loan, [], '2026-03-01'); // 59 días
    expect(early.interestPending).toBeLessThan(late.interestPending);
  });

  it('un préstamo que se alarga más allá del plazo planeado sigue acumulando interés real', () => {
    // term_months no limita la acumulación: el interés sigue creciendo
    // con el tiempo, no se congela ni queda en cero pasado un plazo
    // típico de 6 meses.
    const sixMonths = loanProgress(loan, [], '2026-07-01'); // ~181 días
    const extended = loanProgress(loan, [], '2026-09-01'); // ~243 días
    expect(extended.interestPending).toBeGreaterThan(sixMonths.interestPending);
  });

  it('tras un abono, el interés vuelve a acumularse desde la fecha de ese abono, no desde el préstamo', () => {
    const payments = [{ created_at: '2026-01-16T12:00:00Z', capital_amount: 0, interest_amount: 4931.51 }];
    // Sin este abono, a los 30 días desde el préstamo el interés sería ~9863.01;
    // con el abono a mitad de camino, desde el 16 al 31 de enero (15 días)
    // el interés pendiente debe ser bastante menor.
    const progress = loanProgress(loan, payments, '2026-01-31');
    expect(progress.interestPending).toBeLessThan(9863.01);
    expect(progress.interestPending).toBeCloseTo(1000000 * 0.12 * (15 / 365), 1);
  });

  it('el interés se calcula sobre el capital pendiente, no sobre el capital original, tras abonar capital', () => {
    const payments = [{ created_at: '2026-01-01T12:00:00Z', capital_amount: 500000, interest_amount: 0 }];
    const progress = loanProgress(loan, payments, '2026-01-31');
    expect(progress.capitalPending).toBe(500000);
    // 500.000 al 12% anual por 30 días, no 1.000.000
    expect(progress.interestPending).toBeCloseTo(500000 * 0.12 * (30 / 365), 1);
  });
});
