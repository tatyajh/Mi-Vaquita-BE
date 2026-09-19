import Router from 'express-promise-router';
import pool from '../lib/connection.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = Router();
router.use(authenticateJWT);
const bad = (res, message, code = 400) => res.status(code).json({ message });
const money = value => Math.round(Number(value) * 100) / 100;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value));

async function context(client, id, userId, lock = false) {
  const { rows } = await client.query(`SELECT n.*,to_char(n.starts_on,'YYYY-MM-DD') AS starts_on,to_char(n.ends_on,'YYYY-MM-DD') AS ends_on, EXISTS(SELECT 1 FROM NatilleraMembers m WHERE m.natillera_id=n.id AND m.user_id=$2) AS member FROM Natilleras n WHERE n.id=$1 ${lock ? 'FOR UPDATE OF n' : ''}`, [id, userId]);
  const n = rows[0];
  if (!n || (!n.member && n.owner_id !== userId)) return null;
  return n;
}
async function transaction(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export function dueDates(n) {
  const dates = [];
  const startText = n.starts_on instanceof Date ? n.starts_on.toISOString().slice(0,10) : String(n.starts_on).slice(0,10);
  const endText = n.ends_on instanceof Date ? n.ends_on.toISOString().slice(0,10) : String(n.ends_on).slice(0,10);
  let date = new Date(`${startText}T12:00:00Z`);
  const end = new Date(`${endText}T12:00:00Z`);
  const startDay = date.getUTCDate();
  const startYear = date.getUTCFullYear();
  const startMonth = date.getUTCMonth();
  let monthIndex = 0;
  while (date <= end && dates.length < 370) {
    dates.push(date.toISOString().slice(0, 10));
    if (n.frequency === 'monthly') {
      monthIndex++;
      const next = new Date(Date.UTC(startYear,startMonth+monthIndex,1,12));
      const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();
      next.setUTCDate(Math.min(startDay,daysInMonth));
      date = next;
    }
    else date.setUTCDate(date.getUTCDate() + (n.frequency === 'weekly' ? 7 : 14));
  }
  return dates;
}
async function detail(client, n) {
  const members = (await client.query('SELECT u.id,u.name,u.email FROM NatilleraMembers m JOIN Users u ON u.id=m.user_id WHERE m.natillera_id=$1 ORDER BY u.name', [n.id])).rows;
  const contributions = (await client.query("SELECT c.*,to_char(c.due_on,'YYYY-MM-DD') AS due_on,u.name AS member_name FROM NatilleraContributions c JOIN Users u ON u.id=c.user_id WHERE c.natillera_id=$1 ORDER BY c.created_at DESC", [n.id])).rows;
  const loans = (await client.query('SELECT l.*,u.name AS member_name,COALESCE(SUM(p.amount),0) AS repaid FROM NatilleraLoans l JOIN Users u ON u.id=l.user_id LEFT JOIN NatilleraLoanPayments p ON p.loan_id=l.id WHERE l.natillera_id=$1 GROUP BY l.id,u.name ORDER BY l.id DESC', [n.id])).rows;
  const totalContributions = money(contributions.reduce((s, c) => s + Number(c.amount), 0));
  const totalLoans = money(loans.reduce((s, l) => s + Number(l.principal), 0));
  const totalRepayments = money(loans.reduce((s, l) => s + Number(l.repaid), 0));
  const outstanding = money(loans.reduce((s, l) => s + Math.max(0, Number(l.principal) + Number(l.interest) - Number(l.repaid)), 0));
  const collectedInterest = money(loans.reduce((s, l) => s + Math.max(0, Number(l.repaid) - Number(l.principal)), 0));
  const schedule = members.flatMap(m => dueDates(n).map(date => {
    const paid = money(contributions.filter(c => c.user_id === m.id && String(c.due_on).slice(0, 10) === date).reduce((s, c) => s + Number(c.amount), 0));
    const due = Number(n.contribution);
    return { userId: m.id, name: m.name, dueOn: date, due, paid, balance: money(Math.max(0, due - paid)), status: paid >= due ? 'paid' : date < new Date().toISOString().slice(0,10) ? 'overdue' : paid > 0 ? 'partial' : 'pending' };
  }));
  return { ...n, members, contributions, loans: loans.map(l => ({ ...l, balance: money(Number(l.principal) + Number(l.interest) - Number(l.repaid)) })), schedule, summary: { totalContributions, totalLoans, totalRepayments, outstanding, collectedInterest, available: money(totalContributions - totalLoans + totalRepayments) } };
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query("SELECT DISTINCT n.*,to_char(n.starts_on,'YYYY-MM-DD') AS starts_on,to_char(n.ends_on,'YYYY-MM-DD') AS ends_on FROM Natilleras n JOIN NatilleraMembers m ON m.natillera_id=n.id WHERE m.user_id=$1 ORDER BY n.created_at DESC", [req.userId]);
  res.json(rows);
});
router.post('/', async (req, res) => {
  const { name, startsOn, endsOn, frequency, contribution, participantIds = [] } = req.body;
  if (!name?.trim() || !validDate(startsOn) || !validDate(endsOn) || endsOn < startsOn || !['weekly','biweekly','monthly'].includes(frequency) || !Number.isFinite(Number(contribution)) || Number(contribution) <= 0 || !Array.isArray(participantIds)) return bad(res, 'Revisa nombre, fechas, frecuencia, aporte y participantes');
  const ids = [...new Set([req.userId, ...participantIds.map(Number)])];
  if (ids.some(id => !Number.isInteger(id) || id < 1)) return bad(res, 'Participantes inválidos');
  try {
    const created = await transaction(async client => {
      const users = await client.query('SELECT id FROM Users WHERE id=ANY($1::int[]) AND deleted_at IS NULL', [ids]);
      if (users.rowCount !== ids.length) throw new Error('Algún participante no existe');
      const invited=ids.filter(id=>id!==req.userId);
      if(invited.length){
        const friends=await client.query('SELECT DISTINCT friend_user_id FROM Friends WHERE user_id=$1 AND friend_user_id=ANY($2::int[])',[req.userId,invited]);
        if(friends.rowCount!==invited.length)throw new Error('Solo puedes invitar a tus amigos registrados');
      }
      const { rows } = await client.query('INSERT INTO Natilleras(owner_id,name,starts_on,ends_on,frequency,contribution) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.userId,name.trim(),startsOn,endsOn,frequency,money(contribution)]);
      for (const id of ids) await client.query('INSERT INTO NatilleraMembers(natillera_id,user_id) VALUES($1,$2)', [rows[0].id,id]);
      return rows[0];
    });
    res.status(201).json(created);
  } catch (error) { bad(res, error.message); }
});
router.get('/:id', async (req, res) => {
  const client = await pool.connect();
  try { const n = await context(client, req.params.id, req.userId); if (!n) return bad(res, 'Natillera no encontrada', 404); res.json(await detail(client,n)); }
  finally { client.release(); }
});
router.post('/:id/contributions', async (req, res) => {
  const { userId, dueOn, amount } = req.body;
  if (!validDate(dueOn) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return bad(res, 'Aporte inválido');
  try {
    const row = await transaction(async client => {
      const n = await context(client,req.params.id,req.userId,true);
      if (!n) throw new Error('Natillera no encontrada');
      if (n.owner_id !== req.userId || n.status !== 'active') throw new Error('Solo la administración puede registrar aportes');
      if (!dueDates(n).includes(dueOn)) throw new Error('Fecha de cuota inválida');
      const member = await client.query('SELECT 1 FROM NatilleraMembers WHERE natillera_id=$1 AND user_id=$2',[n.id,userId]);
      if (!member.rowCount) throw new Error('La persona no participa en esta natillera');
      const current = await client.query('SELECT COALESCE(SUM(amount),0) AS paid FROM NatilleraContributions WHERE natillera_id=$1 AND user_id=$2 AND due_on=$3',[n.id,userId,dueOn]);
      if (money(Number(current.rows[0].paid) + Number(amount)) > Number(n.contribution)) throw new Error('El aporte supera el valor de la cuota');
      const { rows } = await client.query('INSERT INTO NatilleraContributions(natillera_id,user_id,due_on,amount,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[n.id,userId,dueOn,money(amount),req.userId]);
      return rows[0];
    });
    res.status(201).json(row);
  } catch (error) { bad(res,error.message); }
});
router.put('/:id/contributions/:contributionId', async (req, res) => {
  const amount = money(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return bad(res,'Valor inválido');
  try {
    const row = await transaction(async client => {
      const n = await context(client,req.params.id,req.userId,true);
      if (!n || n.owner_id !== req.userId || n.status !== 'active') throw new Error('No puedes corregir este aporte');
      const old = (await client.query('SELECT * FROM NatilleraContributions WHERE id=$1 AND natillera_id=$2 FOR UPDATE',[req.params.contributionId,n.id])).rows[0];
      if (!old) throw new Error('Aporte no encontrado');
      const sum = (await client.query('SELECT COALESCE(SUM(amount),0) AS paid FROM NatilleraContributions WHERE natillera_id=$1 AND user_id=$2 AND due_on=$3 AND id<>$4',[n.id,old.user_id,old.due_on,old.id])).rows[0].paid;
      if (money(Number(sum)+amount)>Number(n.contribution)) throw new Error('El aporte supera el valor de la cuota');
      const snapshot=await detail(client,n);
      if (snapshot.summary.available - Number(old.amount) + amount < 0) throw new Error('La corrección dejaría el fondo sin respaldo para los préstamos');
      await client.query('INSERT INTO NatilleraContributionAudit(contribution_id,old_amount,new_amount,changed_by) VALUES($1,$2,$3,$4)',[old.id,old.amount,amount,req.userId]);
      return (await client.query('UPDATE NatilleraContributions SET amount=$1,corrected_at=NOW() WHERE id=$2 RETURNING *',[amount,old.id])).rows[0];
    }); res.json(row);
  } catch(error) { bad(res,error.message); }
});
router.get('/:id/audit', async (req,res) => {
  const n = await context(pool,req.params.id,req.userId);
  if (!n || n.owner_id !== req.userId) return bad(res,'No autorizado',403);
  const { rows } = await pool.query('SELECT a.* FROM NatilleraContributionAudit a JOIN NatilleraContributions c ON c.id=a.contribution_id WHERE c.natillera_id=$1 ORDER BY a.changed_at DESC',[n.id]);
  res.json(rows);
});
router.post('/:id/loans', async (req,res) => {
  const { userId, principal, annualRate, termMonths } = req.body;
  if (![principal,annualRate,termMonths].every(v => Number.isFinite(Number(v))) || Number(principal)<=0 || Number(annualRate)<0 || !Number.isInteger(Number(termMonths)) || Number(termMonths)<1) return bad(res,'Préstamo inválido');
  try {
    const row = await transaction(async client => {
      const n=await context(client,req.params.id,req.userId,true);
      if (!n || n.owner_id!==req.userId || n.status!=='active') throw new Error('No puedes crear este préstamo');
      const d=await detail(client,n);
      if (Number(principal)>d.summary.available) throw new Error('El préstamo supera el dinero disponible');
      if (!d.members.some(m=>m.id===Number(userId))) throw new Error('Participante inválido');
      const interest=money(Number(principal)*Number(annualRate)/100*Number(termMonths)/12);
      return (await client.query('INSERT INTO NatilleraLoans(natillera_id,user_id,principal,annual_rate,term_months,interest,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[n.id,userId,money(principal),annualRate,termMonths,interest,req.userId])).rows[0];
    }); res.status(201).json(row);
  } catch(error) { bad(res,error.message); }
});
router.post('/:id/loans/:loanId/payments', async(req,res) => {
  const amount=money(req.body.amount);
  if (!Number.isFinite(amount)||amount<=0) return bad(res,'Abono inválido');
  try {
    const row=await transaction(async client=>{
      const n=await context(client,req.params.id,req.userId,true);
      if (!n||n.owner_id!==req.userId||n.status!=='active') throw new Error('No puedes registrar este abono');
      const d=await detail(client,n), loan=d.loans.find(l=>l.id===Number(req.params.loanId));
      if (!loan||amount>loan.balance) throw new Error('El abono supera el saldo del préstamo');
      return (await client.query('INSERT INTO NatilleraLoanPayments(loan_id,amount,recorded_by) VALUES($1,$2,$3) RETURNING *',[loan.id,amount,req.userId])).rows[0];
    });res.status(201).json(row);
  } catch(error){bad(res,error.message);}
});
router.get('/:id/closure', async(req,res)=>{
  const n=await context(pool,req.params.id,req.userId);
  if (!n) return bad(res,'Natillera no encontrada',404);
  const existing=(await pool.query('SELECT summary FROM NatilleraClosures WHERE natillera_id=$1',[n.id])).rows[0];
  if (existing) return res.json(existing.summary);
  const d=await detail(pool,n), byMember=d.members.map(m=>({userId:m.id,name:m.name,contributed:money(d.contributions.filter(c=>c.user_id===m.id).reduce((s,c)=>s+Number(c.amount),0))}));
  const total=d.summary.totalContributions;
  let distributed=0;
  const payouts=byMember.map((m,i)=>{const profit=total?(i===byMember.length-1?money(d.summary.collectedInterest-distributed):money(d.summary.collectedInterest*m.contributed/total)):0;distributed=money(distributed+profit);return {...m,profit,payout:money(m.contributed+profit)};});
  res.json({ ...d.summary, payouts, canClose:d.summary.outstanding===0 && d.schedule.every(s=>s.balance===0), reason:d.summary.outstanding>0?'Hay préstamos pendientes':d.schedule.some(s=>s.balance>0)?'Hay cuotas pendientes':null });
});
router.post('/:id/close',async(req,res)=>{
  try {
    const result=await transaction(async client=>{
      const n=await context(client,req.params.id,req.userId,true);
      if (!n||n.owner_id!==req.userId||n.status!=='active') throw new Error('No puedes cerrar esta natillera');
      const d=await detail(client,n);
      if (d.summary.outstanding>0||d.schedule.some(s=>s.balance>0)) throw new Error('Concilia préstamos y cuotas antes de cerrar');
      const byMember=d.members.map(m=>({userId:m.id,name:m.name,contributed:money(d.contributions.filter(c=>c.user_id===m.id).reduce((s,c)=>s+Number(c.amount),0))}));
      let distributed=0;
      const payouts=byMember.map((m,i)=>{const profit=d.summary.totalContributions?(i===byMember.length-1?money(d.summary.collectedInterest-distributed):money(d.summary.collectedInterest*m.contributed/d.summary.totalContributions)):0;distributed=money(distributed+profit);return {...m,profit};});
      const summary={...d.summary,payouts:payouts.map(p=>({...p,payout:money(p.contributed+p.profit)}))};
      await client.query('INSERT INTO NatilleraClosures(natillera_id,summary,confirmed_by) VALUES($1,$2,$3)',[n.id,summary,req.userId]);
      await client.query("UPDATE Natilleras SET status='closed',closed_at=NOW() WHERE id=$1",[n.id]);
      return summary;
    });res.json(result);
  } catch(error){bad(res,error.message);}
});
export default router;
