import Router from 'express-promise-router';
import pool from '../lib/connection.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = Router();
router.use(authenticateJWT);
const bad = (res, message, code = 400) => res.status(code).json({ message });
const money = value => Math.round(Number(value) * 100) / 100;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value));
const monthDate=(value,months)=>{const source=value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);const [year,month,day]=source.split('-').map(Number);const target=new Date(Date.UTC(year,month-1+months,1));const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(day,last));return target.toISOString().slice(0,10);};
// Interés sobre saldo real, no el total fijo calculado al prestar: se
// acumula desde el último abono (o desde que se prestó, si no ha
// pagado nada) hasta `today`, sobre lo que TODAVÍA debe de capital.
// Así, quien paga antes acumula menos días y paga menos interés; un
// préstamo que se alarga sigue acumulando interés real por el tiempo
// de más, en vez de quedar "gratis" después del plazo planeado.
const DAY_MS=24*60*60*1000;
export const loanProgress=(loan,payments,today=new Date().toISOString().slice(0,10))=>{
  const capitalPaid=money(payments.reduce((sum,p)=>sum+Number(p.capital_amount??0),0));
  const interestPaid=money(payments.reduce((sum,p)=>sum+Number(p.interest_amount??0),0));
  const legacyPaid=money(payments.filter(p=>p.capital_amount==null&&p.interest_amount==null).reduce((sum,p)=>sum+Number(p.amount),0));
  const legacyCapital=Math.min(Math.max(0,Number(loan.principal)-capitalPaid),legacyPaid);
  const legacyInterest=Math.max(0,legacyPaid-legacyCapital);
  const capitalPending=money(Math.max(0,Number(loan.principal)-capitalPaid-legacyCapital));
  const lastAccrualOn=payments.length?payments[payments.length-1].created_at:loan.issued_on;
  const daysElapsed=Math.max(0,(new Date(`${today}T12:00:00Z`)-new Date(lastAccrualOn))/DAY_MS);
  const accruedInterest=money(capitalPending*(Number(loan.annual_rate)/100)*(daysElapsed/365));
  return {capitalPaid:money(capitalPaid+legacyCapital),interestPaid:money(interestPaid+legacyInterest),repaid:money(capitalPaid+interestPaid+legacyPaid),capitalPending,interestPending:accruedInterest};
};
const loanSchedule=(installments,repaid,today)=>{let applied=0;return installments.map(i=>{const due=money(Number(i.principal_due)+Number(i.interest_due)),paid=money(Math.min(due,Math.max(0,Number(repaid)-applied)));applied=money(applied+due);return {...i,due,paid,balance:money(due-paid),status:paid>=due?'paid':i.due_on<today?'overdue':paid>0?'partial':'pending'};});};

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
export function buildParticipantSchedule(participants,quotas,payments,today=new Date().toISOString().slice(0,10)){
  const paidByQuota=new Map(payments.map(x=>[`${x.participant_id}:${x.quota_id}`,money(x.paid)]));
  return participants.flatMap(p=>quotas.filter(q=>q.audience==='all'||(q.audience==='guests'&&p.guest_id)).map(q=>{const paid=paidByQuota.get(`${p.participant_id}:${q.id}`)||0;return {participantId:p.participant_id,name:p.name,quotaId:q.id,kind:q.kind,dueOn:q.due_on,due:Number(q.amount),paid,balance:money(Math.max(0,Number(q.amount)-paid)),status:paid>=Number(q.amount)?'paid':q.due_on<today?'overdue':paid>0?'partial':'pending'};}));
}
async function detail(client, n) {
  const members = (await client.query('SELECT u.id,u.name,u.email FROM NatilleraMembers m JOIN Users u ON u.id=m.user_id WHERE m.natillera_id=$1 ORDER BY u.name', [n.id])).rows;
  let participants = (await client.query(`SELECT p.id AS participant_id,p.user_id,p.guest_id,p.role,COALESCE(u.name,g.name) name,COALESCE(u.email,g.email) email,g.phone,COALESCE(SUM(pc.amount),0) recorded_contributed
    FROM NatilleraParticipants p LEFT JOIN Users u ON u.id=p.user_id LEFT JOIN Guests g ON g.id=p.guest_id
    LEFT JOIN NatilleraParticipantContributions pc ON pc.participant_id=p.id WHERE p.natillera_id=$1
    GROUP BY p.id,u.name,u.email,g.name,g.email,g.phone ORDER BY name`,[n.id])).rows;
  const contributions = (await client.query("SELECT c.*,to_char(c.due_on,'YYYY-MM-DD') AS due_on,u.name AS member_name FROM NatilleraContributions c JOIN Users u ON u.id=c.user_id WHERE c.natillera_id=$1 ORDER BY c.created_at DESC", [n.id])).rows;
  participants=participants.map(p=>({...p,recorded_contributed:money(p.recorded_contributed),contributed:money(Number(p.recorded_contributed)+(p.user_id?contributions.filter(c=>c.user_id===p.user_id).reduce((s,c)=>s+Number(c.amount),0):0))}));
  const loanRows = (await client.query('SELECT l.*,u.name AS member_name,u.email,EXISTS(SELECT 1 FROM NatilleraMembers nm WHERE nm.natillera_id=l.natillera_id AND nm.user_id=l.user_id) is_member FROM NatilleraLoans l JOIN Users u ON u.id=l.user_id WHERE l.natillera_id=$1 ORDER BY l.id DESC', [n.id])).rows;
  const loanPayments=loanRows.length?(await client.query('SELECT * FROM NatilleraLoanPayments WHERE loan_id=ANY($1::int[]) ORDER BY created_at,id',[loanRows.map(x=>x.id)])).rows:[];
  const loanInstallments=loanRows.length?(await client.query("SELECT *,to_char(due_on,'YYYY-MM-DD') due_on FROM NatilleraLoanInstallments WHERE loan_id=ANY($1::int[]) ORDER BY loan_id,installment_number",[loanRows.map(x=>x.id)])).rows:[];
  const today=new Date().toISOString().slice(0,10);
  const loans=loanRows.map(l=>{const payments=loanPayments.filter(p=>p.loan_id===l.id),progress=loanProgress(l,payments,today),installments=loanInstallments.filter(i=>i.loan_id===l.id);return {...l,...progress,balance:money(progress.capitalPending+progress.interestPending),payments,installments,schedule:loanSchedule(installments,progress.repaid,today)};});
  const totalContributions = money(contributions.reduce((s, c) => s + Number(c.amount), 0));
  const totalLoans = money(loans.reduce((s, l) => s + Number(l.principal), 0));
  const totalRepayments = money(loans.reduce((s, l) => s + Number(l.repaid), 0));
  const outstanding = money(loans.reduce((s, l) => s + Number(l.balance), 0));
  const collectedInterest = money(loans.reduce((s, l) => s + Number(l.interestPaid), 0));
  const ledger = (await client.query('SELECT * FROM NatilleraLedger WHERE natillera_id=$1 ORDER BY created_at DESC',[n.id])).rows;
  const quotas=(await client.query("SELECT q.*,to_char(q.due_on,'YYYY-MM-DD') due_on FROM NatilleraQuotas q WHERE q.natillera_id=$1 ORDER BY q.due_on,q.id",[n.id])).rows;
  const quotaPayments=(await client.query('SELECT participant_id,quota_id,COALESCE(SUM(amount),0) paid FROM NatilleraParticipantContributions WHERE natillera_id=$1 AND quota_id IS NOT NULL GROUP BY participant_id,quota_id',[n.id])).rows;
  const participantSchedule=buildParticipantSchedule(participants,quotas,quotaPayments);
  const activityProfit = money(ledger.filter(x=>x.kind==='activity_profit').reduce((s,x)=>s+Number(x.amount),0));
  const generalExpenses = money(ledger.filter(x=>x.kind==='general_expense').reduce((s,x)=>s+Math.abs(Number(x.amount)),0));
  // late_fee/adjustment quedaban en el ledger crudo pero nunca sumados
  // a ningún total: una mora cobrada o una corrección de caja
  // "existían" en el historial pero no afectaban estimatedProfit ni
  // available, así que ese dinero real desaparecía de las cuentas al
  // cerrar la natillera. Se guardan con el signo correcto desde que se
  // registran (ver community.router.js), así que se suman tal cual.
  const lateFees = money(ledger.filter(x=>x.kind==='late_fee').reduce((s,x)=>s+Number(x.amount),0));
  const adjustments = money(ledger.filter(x=>x.kind==='adjustment').reduce((s,x)=>s+Number(x.amount),0));
  const schedule = members.flatMap(m => dueDates(n).map(date => {
    const paid = money(contributions.filter(c => c.user_id === m.id && String(c.due_on).slice(0, 10) === date).reduce((s, c) => s + Number(c.amount), 0));
    const due = Number(n.contribution);
    return { userId: m.id, name: m.name, dueOn: date, due, paid, balance: money(Math.max(0, due - paid)), status: paid >= due ? 'paid' : date < new Date().toISOString().slice(0,10) ? 'overdue' : paid > 0 ? 'partial' : 'pending' };
  }));
  const extendedContributions=money(participants.reduce((s,p)=>s+Number(p.recorded_contributed),0));
  return { ...n, members, participants, contributions, loans, ledger, quotas, schedule, participantSchedule, summary: { totalContributions:money(totalContributions+extendedContributions), legacyContributions:totalContributions, extendedContributions, totalLoans, totalRepayments, outstanding, collectedInterest, activityProfit, generalExpenses, lateFees, adjustments, estimatedProfit:money(collectedInterest+activityProfit-generalExpenses+lateFees+adjustments), available: money(totalContributions+extendedContributions-totalLoans+totalRepayments+activityProfit-generalExpenses+lateFees+adjustments) } };
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query("SELECT DISTINCT n.*,to_char(n.starts_on,'YYYY-MM-DD') AS starts_on,to_char(n.ends_on,'YYYY-MM-DD') AS ends_on FROM Natilleras n JOIN NatilleraMembers m ON m.natillera_id=n.id WHERE m.user_id=$1 ORDER BY n.created_at DESC", [req.userId]);
  res.json(rows);
});
router.get('/loans/mine',async(req,res)=>{
  const loans=(await pool.query(`SELECT l.*,n.name natillera_name,u.name borrower_name,EXISTS(SELECT 1 FROM NatilleraMembers nm WHERE nm.natillera_id=l.natillera_id AND nm.user_id=l.user_id) is_member
    FROM NatilleraLoans l JOIN Natilleras n ON n.id=l.natillera_id JOIN Users u ON u.id=l.user_id
    WHERE l.user_id=$1 ORDER BY l.issued_on DESC,l.id DESC`,[req.userId])).rows;
  const ids=loans.map(x=>x.id);
  const payments=ids.length?(await pool.query('SELECT * FROM NatilleraLoanPayments WHERE loan_id=ANY($1::int[]) ORDER BY created_at,id',[ids])).rows:[];
  const installments=ids.length?(await pool.query("SELECT *,to_char(due_on,'YYYY-MM-DD') due_on FROM NatilleraLoanInstallments WHERE loan_id=ANY($1::int[]) ORDER BY loan_id,installment_number",[ids])).rows:[];
  const today=new Date().toISOString().slice(0,10);
  res.json(loans.map(loan=>{const ownPayments=payments.filter(p=>p.loan_id===loan.id),progress=loanProgress(loan,ownPayments,today),schedule=loanSchedule(installments.filter(i=>i.loan_id===loan.id),progress.repaid,today);return {...loan,...progress,balance:money(progress.capitalPending+progress.interestPending),isExternal:!(loan.is_member),payments:ownPayments,schedule};}));
});
router.get('/legal-rates/current',async(req,res)=>{
  const on=/^\d{4}-\d{2}-\d{2}$/.test(req.query.on||'')?req.query.on:new Date().toISOString().slice(0,10);
  const {rows}=await pool.query('SELECT * FROM LegalInterestRates WHERE valid_from<=$1 AND valid_to>=$1 ORDER BY valid_from DESC LIMIT 1',[on]);
  res.json(rows[0]||null);
});
router.post('/:id/members',async(req,res)=>{
  const userId=Number(req.body.userId),role=req.body.role||'member';
  if(!Number.isInteger(userId)||!['admin','treasurer','member','viewer'].includes(role))return bad(res,'Integrante o rol inválido');
  try{const participant=await transaction(async client=>{
    const n=await context(client,req.params.id,req.userId,true);
    if(!n||n.owner_id!==req.userId||n.status!=='active')throw new Error('Solo la administración puede agregar integrantes');
    const user=(await client.query('SELECT id,name,email FROM Users WHERE id=$1 AND deleted_at IS NULL',[userId])).rows[0];
    if(!user)throw new Error('La persona debe tener una cuenta activa');
    await client.query('INSERT INTO NatilleraMembers(natillera_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[n.id,userId]);
    const row=(await client.query('INSERT INTO NatilleraParticipants(natillera_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(natillera_id,user_id) WHERE user_id IS NOT NULL DO UPDATE SET role=EXCLUDED.role RETURNING *',[n.id,userId,role])).rows[0];
    await client.query("INSERT INTO AuditLog(actor_user_id,scope_type,scope_id,action,after_data) VALUES($1,'natillera',$2,'member_added',$3)",[req.userId,n.id,JSON.stringify({userId,role})]);
    return {...row,name:user.name,email:user.email};
  });res.status(201).json(participant);}catch(error){bad(res,error.message);}
});
router.patch('/:id/participants/:participantId/role',async(req,res)=>{
  const role=req.body.role;
  if(!['admin','treasurer','member','viewer'].includes(role))return bad(res,'Rol inválido');
  try{const row=await transaction(async client=>{
    const n=await context(client,req.params.id,req.userId,true);
    if(!n||n.owner_id!==req.userId||n.status!=='active')throw new Error('Solo la administración puede cambiar roles');
    const participant=(await client.query('SELECT * FROM NatilleraParticipants WHERE id=$1 AND natillera_id=$2 FOR UPDATE',[req.params.participantId,n.id])).rows[0];
    if(!participant)throw new Error('Participante no encontrado');
    if(Number(participant.user_id)===Number(n.owner_id)&&role!=='admin')throw new Error('La persona propietaria debe conservar el rol de administración');
    const updated=(await client.query('UPDATE NatilleraParticipants SET role=$1 WHERE id=$2 RETURNING *',[role,participant.id])).rows[0];
    await client.query("INSERT INTO AuditLog(actor_user_id,scope_type,scope_id,action,before_data,after_data) VALUES($1,'natillera',$2,'role_changed',$3,$4)",[req.userId,n.id,JSON.stringify({participantId:participant.id,role:participant.role}),JSON.stringify({participantId:participant.id,role})]);
    return updated;
  });res.json(row);}catch(error){bad(res,error.message);}
});
router.post('/', async (req, res) => {
  const { name, purpose=null, startsOn, endsOn, frequency, contribution, participantIds = [], guestIds = [], profitDistribution='proportional', lateFee=0 } = req.body;
  if (!name?.trim() || !validDate(startsOn) || !validDate(endsOn) || endsOn < startsOn || !['weekly','biweekly','monthly'].includes(frequency) || !Number.isFinite(Number(contribution)) || Number(contribution) <= 0 || !Array.isArray(participantIds) || !Array.isArray(guestIds) || guestIds.length || !['proportional','equal'].includes(profitDistribution) || Number(lateFee)<0) return bad(res, 'La natillera requiere participantes registrados y datos válidos');
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
      const { rows } = await client.query('INSERT INTO Natilleras(owner_id,name,purpose,starts_on,ends_on,frequency,contribution,profit_distribution,late_fee,rules_locked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *', [req.userId,name.trim(),purpose,startsOn,endsOn,frequency,money(contribution),profitDistribution,money(lateFee)]);
      for (const id of ids) await client.query('INSERT INTO NatilleraMembers(natillera_id,user_id) VALUES($1,$2)', [rows[0].id,id]);
      for (const id of ids) await client.query('INSERT INTO NatilleraParticipants(natillera_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [rows[0].id,id,id===req.userId?'admin':'member']);
      for (const dueOn of dueDates({...rows[0],starts_on:startsOn,ends_on:endsOn,frequency})) await client.query("INSERT INTO NatilleraQuotas(natillera_id,kind,name,due_on,amount,audience,created_by) VALUES($1,'ordinary','Cuota ordinaria',$2,$3,'guests',$4)",[rows[0].id,dueOn,money(contribution),req.userId]);
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
  if (!Number.isInteger(Number(userId)) || Number(userId)<1 || ![principal,annualRate,termMonths].every(v => Number.isFinite(Number(v))) || Number(principal)<=0 || Number(annualRate)<0 || !Number.isInteger(Number(termMonths)) || Number(termMonths)<1) return bad(res,'Préstamo inválido');
  try {
    const row = await transaction(async client => {
      const n=await context(client,req.params.id,req.userId,true);
      if (!n || n.owner_id!==req.userId || n.status!=='active') throw new Error('No puedes crear este préstamo');
      const d=await detail(client,n);
      if (Number(principal)>d.summary.available) throw new Error('El préstamo supera el dinero disponible');
      const borrower=(await client.query('SELECT id FROM Users WHERE id=$1 AND deleted_at IS NULL',[Number(userId)])).rows[0];
      if(!borrower)throw new Error('El prestatario debe tener una cuenta activa en Mi Vaquita');
      // El cronograma es una ESTIMACIÓN sobre saldo decreciente (si se
      // paga puntual mes a mes) para mostrar fechas y montos de
      // referencia; el interés que realmente se cobra al abonar (ver
      // loanProgress más abajo) se calcula sobre el tiempo real
      // transcurrido y el saldo real pendiente, no sobre este plan —
      // así pagar antes cobra menos interés y un préstamo que se
      // alarga acumula más, como un préstamo de verdad.
      const monthlyRate=Number(annualRate)/100/12;
      let remaining=Number(principal),principalAssigned=0,estimatedInterest=0;
      const plannedInstallments=[];
      for(let installment=1;installment<=Number(termMonths);installment++){
        const principalDue=installment===Number(termMonths)?money(Number(principal)-principalAssigned):money(Number(principal)/Number(termMonths));
        const interestDue=money(remaining*monthlyRate);
        principalAssigned=money(principalAssigned+principalDue);
        remaining=money(Math.max(0,remaining-principalDue));
        estimatedInterest=money(estimatedInterest+interestDue);
        plannedInstallments.push({installment,principalDue,interestDue});
      }
      const loan=(await client.query('INSERT INTO NatilleraLoans(natillera_id,user_id,principal,annual_rate,term_months,interest,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[n.id,userId,money(principal),annualRate,termMonths,estimatedInterest,req.userId])).rows[0];
      for(const p of plannedInstallments){
        await client.query('INSERT INTO NatilleraLoanInstallments(loan_id,installment_number,due_on,principal_due,interest_due) VALUES($1,$2,$3,$4,$5)',[loan.id,p.installment,monthDate(loan.issued_on,p.installment),p.principalDue,p.interestDue]);
      }
      const interest=estimatedInterest;
      await client.query("INSERT INTO AuditLog(actor_user_id,scope_type,scope_id,action,after_data) VALUES($1,'loan',$2,'loan_created',$3)",[req.userId,loan.id,JSON.stringify({natilleraId:n.id,borrowerUserId:Number(userId),external:!d.members.some(m=>m.id===Number(userId)),principal:money(principal),interest})]);
      const legalRate=(await client.query('SELECT * FROM LegalInterestRates WHERE valid_from<=CURRENT_DATE AND valid_to>=CURRENT_DATE ORDER BY valid_from DESC LIMIT 1')).rows[0]||null;
      return {...loan,legalRate,rateWarning:legalRate&&Number(annualRate)>Number(legalRate.annual_effective_rate)?'La tasa registrada supera la referencia legal vigente. Revisa la equivalencia y consulta asesoría antes de continuar.':null};
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
      const interestAmount=money(Math.min(amount,Number(loan.interestPending))),capitalAmount=money(amount-interestAmount);
      const payment=(await client.query('INSERT INTO NatilleraLoanPayments(loan_id,amount,capital_amount,interest_amount,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[loan.id,amount,capitalAmount,interestAmount,req.userId])).rows[0];
      await client.query("INSERT INTO AuditLog(actor_user_id,scope_type,scope_id,action,after_data) VALUES($1,'loan',$2,'loan_payment_recorded',$3)",[req.userId,loan.id,JSON.stringify(payment)]);
      return payment;
    });res.status(201).json(row);
  } catch(error){bad(res,error.message);}
});
router.get('/:id/closure', async(req,res)=>{
  const n=await context(pool,req.params.id,req.userId);
  if (!n) return bad(res,'Natillera no encontrada',404);
  const existing=(await pool.query('SELECT summary FROM NatilleraClosures WHERE natillera_id=$1',[n.id])).rows[0];
  if (existing) return res.json(existing.summary);
  const d=await detail(pool,n), extendedUsers=new Set(d.participants.filter(p=>p.user_id).map(p=>p.user_id)), byMember=[...d.members.filter(m=>!extendedUsers.has(m.id)).map(m=>({userId:m.id,name:m.name,contributed:money(d.contributions.filter(c=>c.user_id===m.id).reduce((s,c)=>s+Number(c.amount),0))})),...d.participants.map(p=>({participantId:p.participant_id,userId:p.user_id,guestId:p.guest_id,name:p.name,contributed:p.contributed}))];
  const total=d.summary.totalContributions, distributable=d.summary.estimatedProfit;
  let distributed=0;
  const payouts=byMember.map((m,i)=>{const profit=n.profit_distribution==='equal'?(i===byMember.length-1?money(distributable-distributed):money(distributable/byMember.length)):total?(i===byMember.length-1?money(distributable-distributed):money(distributable*m.contributed/total)):0;distributed=money(distributed+profit);return {...m,profit,payout:money(m.contributed+profit)};});
  const hasPending=d.schedule.some(s=>s.balance>0)||d.participantSchedule.some(s=>s.balance>0);
  res.json({ ...d.summary, payouts, canClose:d.summary.outstanding===0 && !hasPending, reason:d.summary.outstanding>0?'Hay préstamos pendientes':hasPending?'Hay cuotas pendientes':null });
});
router.post('/:id/close',async(req,res)=>{
  try {
    const result=await transaction(async client=>{
      const n=await context(client,req.params.id,req.userId,true);
      if (!n||n.owner_id!==req.userId||n.status!=='active') throw new Error('No puedes cerrar esta natillera');
      const d=await detail(client,n);
      if (d.summary.outstanding>0||d.schedule.some(s=>s.balance>0)||d.participantSchedule.some(s=>s.balance>0)) throw new Error('Concilia préstamos y cuotas antes de cerrar');
      const extendedUsers=new Set(d.participants.filter(p=>p.user_id).map(p=>p.user_id));
      const byMember=[...d.members.filter(m=>!extendedUsers.has(m.id)).map(m=>({userId:m.id,name:m.name,contributed:money(d.contributions.filter(c=>c.user_id===m.id).reduce((s,c)=>s+Number(c.amount),0))})),...d.participants.map(p=>({participantId:p.participant_id,userId:p.user_id,guestId:p.guest_id,name:p.name,contributed:p.contributed}))];
      let distributed=0;
      const distributable=d.summary.estimatedProfit;
      const payouts=byMember.map((m,i)=>{const profit=n.profit_distribution==='equal'?(i===byMember.length-1?money(distributable-distributed):money(distributable/byMember.length)):d.summary.totalContributions?(i===byMember.length-1?money(distributable-distributed):money(distributable*m.contributed/d.summary.totalContributions)):0;distributed=money(distributed+profit);return {...m,profit};});
      const summary={...d.summary,payouts:payouts.map(p=>({...p,payout:money(p.contributed+p.profit)}))};
      await client.query('INSERT INTO NatilleraClosures(natillera_id,summary,confirmed_by) VALUES($1,$2,$3)',[n.id,summary,req.userId]);
      await client.query("UPDATE Natilleras SET status='closed',closed_at=NOW() WHERE id=$1",[n.id]);
      return summary;
    });res.json(result);
  } catch(error){bad(res,error.message);}
});
export default router;
