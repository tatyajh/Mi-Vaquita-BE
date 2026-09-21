import pool from '../lib/connection.js';
import { sendReminderEmail } from './email.service.js';

const iso = value => String(value).slice(0,10);
const todayInBogota = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addMonths = (date, months) => {
  const [year,month,day]=iso(date).split('-').map(Number);
  const target=new Date(Date.UTC(year,month-1+Number(months),1));
  const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(day,lastDay));
  return target.toISOString().slice(0,10);
};

export async function getCalendarEvents(userId, { start='1900-01-01', end='2999-12-31' }={}) {
  const params=[userId,start,end];
  const quota=(await pool.query(`SELECT q.id,n.id natillera_id,n.name natillera_name,q.name,to_char(q.due_on,'YYYY-MM-DD') event_date,q.amount,
      COALESCE((SELECT SUM(c.amount) FROM NatilleraParticipantContributions c JOIN NatilleraParticipants np2 ON np2.id=c.participant_id WHERE c.quota_id=q.id AND np2.user_id=$1),0)+
      COALESCE((SELECT SUM(c.amount) FROM NatilleraContributions c WHERE c.natillera_id=n.id AND c.user_id=$1 AND c.due_on=q.due_on),0) paid
    FROM NatilleraQuotas q JOIN Natilleras n ON n.id=q.natillera_id JOIN NatilleraMembers m ON m.natillera_id=n.id AND m.user_id=$1
    WHERE n.status='active' AND q.due_on BETWEEN $2 AND $3 ORDER BY q.due_on`,params)).rows.map(x=>({
      id:`quota:${x.id}`,type:'contribution',date:x.event_date,title:`${x.name} · ${x.natillera_name}`,amount:Number(x.amount),status:Number(x.paid)>=Number(x.amount)?'completed':x.event_date<todayInBogota()?'overdue':'pending',link:`/natilleras/${x.natillera_id}`
    }));
  const activities=(await pool.query(`SELECT DISTINCT a.id,a.name,a.type,to_char(a.event_on,'YYYY-MM-DD') event_date,a.status FROM Activities a LEFT JOIN ActivityParticipants p ON p.activity_id=a.id WHERE (a.owner_id=$1 OR p.user_id=$1) AND a.event_on BETWEEN $2 AND $3`,params)).rows.map(x=>({id:`activity:${x.id}`,type:'activity',subtype:x.type,date:x.event_date,title:x.name,status:x.status==='closed'?'completed':'pending',link:`/activities/${x.id}`}));
  const natilleras=(await pool.query(`SELECT n.id,n.name,to_char(n.starts_on,'YYYY-MM-DD') starts_on,to_char(n.ends_on,'YYYY-MM-DD') ends_on,n.status FROM Natilleras n JOIN NatilleraMembers m ON m.natillera_id=n.id WHERE m.user_id=$1 AND (n.starts_on BETWEEN $2 AND $3 OR n.ends_on BETWEEN $2 AND $3)`,params)).rows.flatMap(x=>[
    ...(x.starts_on>=start&&x.starts_on<=end?[{id:`natillera-start:${x.id}`,type:'natillera',date:x.starts_on,title:`Inicio de ${x.name}`,status:x.starts_on<todayInBogota()?'completed':'pending',link:`/natilleras/${x.id}`}]:[]),
    ...(x.ends_on>=start&&x.ends_on<=end?[{id:`natillera-end:${x.id}`,type:'natillera',date:x.ends_on,title:`Cierre de ${x.name}`,status:x.status==='closed'?'completed':x.ends_on<todayInBogota()?'overdue':'pending',link:`/natilleras/${x.id}`}]:[])
  ]);
  const loanRows=(await pool.query(`SELECT l.id,l.natillera_id,n.name,l.issued_on,l.term_months,l.principal,l.interest,COALESCE((SELECT SUM(p.amount) FROM NatilleraLoanPayments p WHERE p.loan_id=l.id),0) repaid,EXISTS(SELECT 1 FROM NatilleraMembers m WHERE m.natillera_id=l.natillera_id AND m.user_id=$1) is_member FROM NatilleraLoans l JOIN Natilleras n ON n.id=l.natillera_id WHERE l.user_id=$1`,[userId])).rows;
  const loanIds=loanRows.map(x=>x.id),installments=loanIds.length?(await pool.query("SELECT *,to_char(due_on,'YYYY-MM-DD') due_on FROM NatilleraLoanInstallments WHERE loan_id=ANY($1::int[]) ORDER BY loan_id,installment_number",[loanIds])).rows:[];
  const loans=loanRows.flatMap(loan=>{let applied=0;const scheduled=installments.filter(i=>i.loan_id===loan.id).map(i=>{const due=Number(i.principal_due)+Number(i.interest_due),paid=Math.min(due,Math.max(0,Number(loan.repaid)-applied));applied+=due;return {id:`loan-installment:${i.id}`,type:'loan',date:i.due_on,title:`Cuota ${i.installment_number} del préstamo · ${loan.name}`,amount:Math.max(0,due-paid),status:paid>=due?'completed':i.due_on<todayInBogota()?'overdue':'pending',link:loan.is_member?`/natilleras/${loan.natillera_id}`:'/mis-prestamos'};});if(scheduled.length)return scheduled;const date=addMonths(loan.issued_on,loan.term_months);return [{id:`loan:${loan.id}`,type:'loan',date,title:`Vencimiento de préstamo · ${loan.name}`,amount:Math.max(0,Number(loan.principal)+Number(loan.interest)-Number(loan.repaid)),status:Number(loan.repaid)>=Number(loan.principal)+Number(loan.interest)?'completed':date<todayInBogota()?'overdue':'pending',link:loan.is_member?`/natilleras/${loan.natillera_id}`:'/mis-prestamos'}];}).filter(x=>x.date>=start&&x.date<=end);
  return [...quota,...activities,...natilleras,...loans].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}

export async function ensureReminders(userId, today=todayInBogota()) {
  const prefs=(await pool.query(`INSERT INTO ReminderPreferences(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`,[userId])).rows[0];
  if(!prefs.in_app_enabled&&!prefs.email_enabled)return [];
  const from=new Date(`${today}T12:00:00Z`);from.setUTCDate(from.getUTCDate()-1);
  const to=new Date(`${today}T12:00:00Z`);to.setUTCDate(to.getUTCDate()+7);
  const events=await getCalendarEvents(userId,{start:from.toISOString().slice(0,10),end:to.toISOString().slice(0,10)});
  for(const event of events.filter(x=>x.status!=='completed')){
    const days=Math.round((new Date(`${event.date}T12:00:00Z`)-new Date(`${today}T12:00:00Z`))/86400000);
    const timing=days===7&&prefs.days_before.includes(7)?'7_days':days===1&&prefs.days_before.includes(1)?'1_day':days===-1&&prefs.overdue_enabled?'overdue':null;
    if(timing)await pool.query(`INSERT INTO CalendarReminders(user_id,event_key,event_type,event_date,timing,title,link,amount,email_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,event_key,timing) DO NOTHING`,[userId,event.id,event.type,event.date,timing,event.title,event.link,event.amount??null,prefs.email_enabled?'pending':'skipped']);
  }
  return (await pool.query(`SELECT * FROM CalendarReminders WHERE user_id=$1 ORDER BY event_date DESC,created_at DESC LIMIT 50`,[userId])).rows;
}

export async function dispatchReminders() {
  const users=(await pool.query('SELECT id,email FROM Users WHERE deleted_at IS NULL')).rows;
  let sent=0,failed=0;
  for(const user of users){
    await ensureReminders(user.id);
    const pending=(await pool.query("SELECT * FROM CalendarReminders WHERE user_id=$1 AND email_status IN ('pending','failed') AND email_attempts<3",[user.id])).rows;
    for(const item of pending)try{await sendReminderEmail(user.email,item);await pool.query("UPDATE CalendarReminders SET email_status='sent',email_attempts=email_attempts+1,last_error=NULL WHERE id=$1",[item.id]);sent++;}catch(error){await pool.query("UPDATE CalendarReminders SET email_status='failed',email_attempts=email_attempts+1,last_error=$2 WHERE id=$1",[item.id,error.message.slice(0,500)]);failed++;}
  }
  return {sent,failed};
}
