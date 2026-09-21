import Router from 'express-promise-router';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../lib/connection.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { matching } from './activities.router.js';
import { sendInvitationEmail, sendSecretSantaEmail } from '../services/email.service.js';
import { rateLimit } from '../middleware/rate-limit.middleware.js';
import { encryptDeliveryUrl, decryptDeliveryUrl } from '../utils/private-url.crypto.js';
export { encryptDeliveryUrl, decryptDeliveryUrl } from '../utils/private-url.crypto.js';

const router = Router();
const fail = (res, message, status = 400) => res.status(status).json({ message });
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizedEmail = value => value ? String(value).trim().toLowerCase() : null;
const frontendUrl = () => String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
export const buildPreparedWhatsapp = row => { const privateUrl=decryptDeliveryUrl(row.delivery_url); return {notificationId:row.id,participantId:row.participant_id,whatsappUrl:`https://wa.me/${String(row.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent(`En ${row.name}, te tocó ${row.recipient_name}. Mira tu asignación privada: ${privateUrl}`)}`}; };
const tx = async fn => {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
};

async function getActivity(db, id, principal, lock = false) {
  const { rows } = await db.query(`
    SELECT a.*, COALESCE(a.owner_id,g.owneruserid) AS effective_owner,
      EXISTS(SELECT 1 FROM ActivityParticipants p WHERE p.activity_id=a.id AND p.user_id=$2) AS user_member,
      EXISTS(SELECT 1 FROM ActivityParticipants p WHERE p.activity_id=a.id AND p.guest_id=$3) AS guest_member,
      EXISTS(SELECT 1 FROM ActivityParticipants p WHERE p.activity_id=a.id AND p.user_id=$2 AND p.role IN ('admin','responsible')) AS participant_manager
    FROM Activities a LEFT JOIN Groups g ON g.id=a.group_id
    WHERE a.id=$1 ${lock ? 'FOR UPDATE OF a' : ''}`,
    [id, principal.userId || null, principal.guestId || null]);
  const activity = rows[0];
  if (!activity) return null;
  if (activity.effective_owner !== principal.userId && !activity.user_member && !activity.guest_member) return null;
  return activity;
}

function guestOrUser(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    const payload = jwt.verify(header.replace(/^Bearer\s+/i, ''), process.env.JWT_SECRET);
    req.principal = { userId: payload.id || null, guestId: payload.guestId || null, scope: payload.scope || null };
    if (!req.principal.userId && !req.principal.guestId) throw new Error('invalid');
    next();
  } catch { fail(res, 'Acceso inválido o vencido', 401); }
}

// Reclama una invitación de un solo uso y entrega una sesión limitada al alcance invitado.
router.post('/invitations/claim', rateLimit({ max: 8 }), async (req, res) => {
  const { token, pin } = req.body;
  if (!token || !/^\d{4,8}$/.test(String(pin || ''))) return fail(res, 'Token y PIN de 4 a 8 dígitos requeridos');
  try {
    const invitation = await tx(async db => {
      const row = (await db.query(`SELECT * FROM Invitations WHERE token_hash=$1 AND revoked_at IS NULL AND claimed_at IS NULL AND expires_at>NOW() FOR UPDATE`, [hashToken(token)])).rows[0];
      if (!row) throw new Error('La invitación no es válida, ya fue usada o venció');
      const pinHash = await bcrypt.hash(String(pin), 10);
      await db.query('UPDATE Invitations SET pin_hash=$1,claimed_at=NOW() WHERE id=$2', [pinHash, row.id]);
      await db.query("INSERT INTO AuditLog(actor_guest_id,scope_type,scope_id,action,after_data) VALUES($1,$2,$3,'invitation_claimed',$4)", [row.guest_id,row.scope_type,row.scope_id,JSON.stringify({invitationId:row.id})]);
      return row;
    });
    const accessToken = jwt.sign({ guestId: invitation.guest_id, scope: { type: invitation.scope_type, id: invitation.scope_id } }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ accessToken, scope: { type: invitation.scope_type, id: invitation.scope_id } });
  } catch (error) { fail(res, error.message); }
});

// Una sesión invitada puede renovarse con su PIN, pero únicamente para su invitación.
router.post('/invitations/access', rateLimit({ max: 8 }), async (req, res) => {
  const { token, pin } = req.body;
  const row = (await pool.query('SELECT * FROM Invitations WHERE token_hash=$1 AND revoked_at IS NULL AND claimed_at IS NOT NULL AND expires_at>NOW()', [hashToken(token || '')])).rows[0];
  if (!row || !row.pin_hash || !(await bcrypt.compare(String(pin || ''), row.pin_hash))) return fail(res, 'PIN o invitación inválidos', 401);
  const accessToken = jwt.sign({ guestId: row.guest_id, scope: { type: row.scope_type, id: row.scope_id } }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ accessToken, scope: { type: row.scope_type, id: row.scope_id } });
});

router.get('/activities/:id/private', guestOrUser, async (req, res) => {
  const a = await getActivity(pool, req.params.id, req.principal);
  if (!a || (req.principal.guestId && (req.principal.scope?.type !== 'activity' || Number(req.principal.scope.id) !== a.id))) return fail(res, 'Actividad no encontrada', 404);
  const participant = (await pool.query(`SELECT p.id,p.number,r.id AS recipient_id,COALESCE(ru.name,rg.name) AS recipient_name
    FROM ActivityParticipants p LEFT JOIN ActivityParticipants r ON r.id=p.recipient_participant_id
    LEFT JOIN Users ru ON ru.id=r.user_id LEFT JOIN Guests rg ON rg.id=r.guest_id
    WHERE p.activity_id=$1 AND (p.user_id=$2 OR p.guest_id=$3)`, [a.id,req.principal.userId || null,req.principal.guestId || null])).rows[0];
  res.json({ id:a.id,type:a.type,name:a.name,eventOn:a.event_on,budget:a.budget,status:a.status,myNumber:participant?.number,myRecipient:participant?.recipient_id ? { id:participant.recipient_id,name:participant.recipient_name } : null });
});

router.get('/natilleras/:id/private', guestOrUser, async(req,res)=>{
  if(req.principal.guestId&&(req.principal.scope?.type!=='natillera'||Number(req.principal.scope.id)!==Number(req.params.id)))return fail(res,'Natillera no encontrada',404);
  const participant=(await pool.query(`SELECT p.id,p.role,n.id natillera_id,n.name,n.purpose,n.status,n.contribution,n.frequency,n.starts_on,n.ends_on,n.profit_distribution,
    COALESCE(SUM(c.amount),0) contributed FROM NatilleraParticipants p JOIN Natilleras n ON n.id=p.natillera_id
    LEFT JOIN NatilleraParticipantContributions c ON c.participant_id=p.id
    WHERE n.id=$1 AND (p.user_id=$2 OR p.guest_id=$3) GROUP BY p.id,n.id`,[req.params.id,req.principal.userId||null,req.principal.guestId||null])).rows[0];
  if(!participant)return fail(res,'Natillera no encontrada',404);
  res.json({...participant,contributed:Number(participant.contributed),notice:'Registrado en Mi Vaquita · pagado por fuera'});
});

router.use(authenticateJWT);

router.post('/guests', async (req, res) => {
  const name = String(req.body.name || '').trim(), email = normalizedEmail(req.body.email), phone = String(req.body.phone || '').trim() || null;
  if (!name || (!email && !phone)) return fail(res, 'Nombre y correo o WhatsApp son requeridos');
  const existing = email ? (await pool.query('SELECT * FROM Guests WHERE created_by=$1 AND LOWER(email)=LOWER($2) AND claimed_user_id IS NULL',[req.userId,email])).rows[0] : null;
  if (existing) return res.json(existing);
  const row = (await pool.query('INSERT INTO Guests(name,email,phone,created_by) VALUES($1,$2,$3,$4) RETURNING *',[name,email,phone,req.userId])).rows[0];
  res.status(201).json(row);
});

router.post('/natilleras/:id/invitations',async(req,res)=>{
  const participant=(await pool.query(`SELECT p.*,g.name,g.email,g.phone,n.name natillera_name,n.owner_id FROM NatilleraParticipants p JOIN Guests g ON g.id=p.guest_id JOIN Natilleras n ON n.id=p.natillera_id WHERE p.id=$1 AND n.id=$2`,[req.body.participantId,req.params.id])).rows[0];
  if(!participant||participant.owner_id!==req.userId)return fail(res,'No autorizado',403);
  const raw=crypto.randomBytes(32).toString('hex');
  const invitation=(await pool.query("INSERT INTO Invitations(scope_type,scope_id,guest_id,token_hash,expires_at,created_by) VALUES('natillera',$1,$2,$3,NOW()+INTERVAL '7 days',$4) RETURNING id,expires_at",[req.params.id,participant.guest_id,hashToken(raw),req.userId])).rows[0];
  const claimUrl=`${frontendUrl()}/invitacion?token=${raw}`;let emailStatus='not_applicable';
  if(participant.email){try{await sendInvitationEmail(participant.email,{activityName:participant.natillera_name,claimUrl});emailStatus='sent';}catch(error){emailStatus='failed';console.error('No se pudo enviar invitación:',error.message);}}
  const whatsappUrl=participant.phone?`https://wa.me/${participant.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Te invitaron a la natillera ${participant.natillera_name}. Abre ${claimUrl}`)}`:null;
  res.status(201).json({id:invitation.id,expiresAt:invitation.expires_at,emailStatus,whatsappUrl});
});

router.post('/natilleras/:id/quotas',async(req,res)=>{
  const {kind='extraordinary',name,dueOn,amount}=req.body;
  if(!['ordinary','extraordinary','late_fee'].includes(kind)||!String(name||'').trim()||!/^\d{4}-\d{2}-\d{2}$/.test(dueOn||'')||Number(amount)<0)return fail(res,'Cuota inválida');
  const role=(await pool.query('SELECT p.role,n.status FROM NatilleraParticipants p JOIN Natilleras n ON n.id=p.natillera_id WHERE p.natillera_id=$1 AND p.user_id=$2',[req.params.id,req.userId])).rows[0];
  if(!role||!['admin','treasurer'].includes(role.role)||role.status!=='active')return fail(res,'No autorizado',403);
  const row=(await pool.query("INSERT INTO NatilleraQuotas(natillera_id,kind,name,due_on,amount,audience,created_by) VALUES($1,$2,$3,$4,$5,'all',$6) RETURNING *",[req.params.id,kind,name.trim(),dueOn,Number(amount),req.userId])).rows[0];res.status(201).json(row);
});

router.post('/natilleras/:id/contributions',async(req,res)=>{
  const {participantId,quotaId=null,amount,kind='payment',note=null,adjustmentOf=null}=req.body;
  if(!['payment','adjustment','reversal'].includes(kind)||!Number(amount)||kind==='payment'&&Number(amount)<0)return fail(res,'Aporte inválido');
  try{const row=await tx(async db=>{
    const actor=(await db.query('SELECT p.role,n.status FROM NatilleraParticipants p JOIN Natilleras n ON n.id=p.natillera_id WHERE p.natillera_id=$1 AND p.user_id=$2 FOR UPDATE OF n',[req.params.id,req.userId])).rows[0];
    if(!actor||!['admin','treasurer'].includes(actor.role)||actor.status!=='active')throw new Error('No autorizado');
    const participant=(await db.query('SELECT * FROM NatilleraParticipants WHERE id=$1 AND natillera_id=$2',[participantId,req.params.id])).rows[0];if(!participant)throw new Error('Participante inválido');
    if(participant.guest_id&&!quotaId)throw new Error('Los aportes de invitados deben asociarse a una cuota');
    if(quotaId&&!(await db.query('SELECT 1 FROM NatilleraQuotas WHERE id=$1 AND natillera_id=$2',[quotaId,req.params.id])).rowCount)throw new Error('Cuota inválida');
    if(adjustmentOf&&!(await db.query('SELECT 1 FROM NatilleraParticipantContributions WHERE id=$1 AND natillera_id=$2',[adjustmentOf,req.params.id])).rowCount)throw new Error('Movimiento original inválido');
    const created=(await db.query('INSERT INTO NatilleraParticipantContributions(natillera_id,participant_id,quota_id,amount,kind,note,adjustment_of,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[req.params.id,participantId,quotaId,Number(amount),kind,note,adjustmentOf,req.userId])).rows[0];
    await db.query("INSERT INTO AuditLog(actor_user_id,scope_type,scope_id,action,after_data) VALUES($1,'natillera',$2,$3,$4)",[req.userId,req.params.id,kind==='payment'?'contribution_recorded':'contribution_adjusted',JSON.stringify(created)]);return created;
  });res.status(201).json(row);}catch(error){fail(res,error.message,error.message==='No autorizado'?403:400);}
});

router.post('/natilleras/:id/ledger',async(req,res)=>{
  const {kind,amount,description,reversalOf=null}=req.body;
  if(!['general_expense','late_fee','adjustment'].includes(kind)||!Number(amount)||!String(description||'').trim())return fail(res,'Movimiento inválido');
  try{const row=await tx(async db=>{const actor=(await db.query('SELECT p.role,n.status FROM NatilleraParticipants p JOIN Natilleras n ON n.id=p.natillera_id WHERE p.natillera_id=$1 AND p.user_id=$2 FOR UPDATE OF n',[req.params.id,req.userId])).rows[0];if(!actor||!['admin','treasurer'].includes(actor.role)||actor.status!=='active')throw new Error('No autorizado');let finalAmount=kind==='general_expense'?-Math.abs(Number(amount)):Number(amount);if(reversalOf){const original=(await db.query('SELECT * FROM NatilleraLedger WHERE id=$1 AND natillera_id=$2',[reversalOf,req.params.id])).rows[0];if(!original)throw new Error('Movimiento original inválido');finalAmount=-Number(original.amount);}const created=(await db.query('INSERT INTO NatilleraLedger(natillera_id,kind,amount,description,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.params.id,kind,finalAmount,description.trim(),req.userId])).rows[0];await db.query("INSERT INTO AuditLog(actor_user_id,scope_type,scope_id,action,after_data) VALUES($1,'natillera',$2,$3,$4)",[req.userId,req.params.id,reversalOf?'ledger_reversed':'ledger_recorded',JSON.stringify({...created,reversalOf})]);return created;});res.status(201).json(row);}catch(error){fail(res,error.message,error.message==='No autorizado'?403:400);}
});

router.post('/activities', async (req, res) => {
  const { type, name, eventOn, budget = null, description = null, natilleraId = null, participants = [], leaderUserId = null } = req.body;
  const validTypes = ['secret_santa','raffle','sale','bazaar','bingo','game','food','other'];
  if (!validTypes.includes(type) || !String(name || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(eventOn || '') || !Array.isArray(participants)) return fail(res, 'Datos de actividad inválidos');
  try {
    const activity = await tx(async db => {
      if (natilleraId) {
        const access = await db.query('SELECT 1 FROM Natilleras WHERE id=$1 AND owner_id=$2',[natilleraId,req.userId]);
        if (!access.rowCount) throw new Error('No puedes asociar esta natillera');
      }
      const row = (await db.query('INSERT INTO Activities(group_id,type,name,event_on,budget,status,created_by,owner_id,natillera_id,description) VALUES(NULL,$1,$2,$3,$4,\'draft\',$5,$5,$6,$7) RETURNING *',[type,name.trim(),eventOn,budget,req.userId,natilleraId,description])).rows[0];
      let natilleraParticipants=[];
      if(natilleraId)natilleraParticipants=(await db.query('SELECT user_id AS "userId" FROM NatilleraParticipants WHERE natillera_id=$1 AND user_id IS NOT NULL',[natilleraId])).rows;
      const refs = [{ userId:req.userId, role:'admin' }, ...natilleraParticipants, ...participants];
      for (const ref of refs) {
        const userId = ref.userId ? Number(ref.userId) : null, guestId = ref.guestId ? Number(ref.guestId) : null;
        if ((!userId && !guestId) || (userId && guestId)) throw new Error('Participante inválido');
        if (guestId && !(await db.query('SELECT 1 FROM Guests WHERE id=$1 AND created_by=$2',[guestId,req.userId])).rowCount) throw new Error('Invitado inválido');
        await db.query('INSERT INTO ActivityParticipants(activity_id,user_id,guest_id,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[row.id,userId,guestId,ref.role || 'participant']);
      }
      if(leaderUserId&&Number(leaderUserId)!==req.userId){const changed=await db.query("UPDATE ActivityParticipants SET role='responsible' WHERE activity_id=$1 AND user_id=$2",[row.id,Number(leaderUserId)]);if(!changed.rowCount)throw new Error('La persona líder debe participar en la actividad');}
      return row;
    });
    res.status(201).json(activity);
  } catch (error) { fail(res,error.message); }
});

router.get('/activities', async (req,res)=>{
  const {rows}=await pool.query(`SELECT DISTINCT a.id,a.type,a.name,to_char(a.event_on,'YYYY-MM-DD') event_on,a.budget,a.status,a.natillera_id,a.reconciled_at,a.created_at
    FROM Activities a LEFT JOIN Groups g ON g.id=a.group_id LEFT JOIN ActivityParticipants p ON p.activity_id=a.id
    WHERE a.owner_id=$1 OR g.owneruserid=$1 OR p.user_id=$1 ORDER BY a.created_at DESC`,[req.userId]);
  res.json(rows);
});

router.get('/activities/:id', async (req, res) => {
  const a = await getActivity(pool,req.params.id,{userId:req.userId});
  if (!a) return fail(res,'Actividad no encontrada',404);
  const participants=(await pool.query(`SELECT p.id,p.role,p.number,p.user_id,p.guest_id,COALESCE(u.name,g.name) AS name,u.email AS user_email,g.email AS guest_email,g.phone
    FROM ActivityParticipants p LEFT JOIN Users u ON u.id=p.user_id LEFT JOIN Guests g ON g.id=p.guest_id WHERE p.activity_id=$1 ORDER BY name`,[a.id])).rows;
  const totals=(await pool.query(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN kind IN ('cost','expense') THEN amount ELSE 0 END),0) costs,COALESCE(SUM(CASE WHEN kind='adjustment' THEN amount ELSE 0 END),0) adjustments FROM FundraisingTransactions WHERE activity_id=$1 AND reversed_transaction_id IS NULL`,[a.id])).rows[0];
  const transactions=(await pool.query('SELECT * FROM FundraisingTransactions WHERE activity_id=$1 ORDER BY occurred_at DESC,id DESC',[a.id])).rows;
  const products=(await pool.query(`SELECT p.*,COALESCE(SUM(m.quantity),0) stock FROM InventoryProducts p LEFT JOIN InventoryMovements m ON m.product_id=p.id WHERE p.activity_id=$1 GROUP BY p.id ORDER BY p.name`,[a.id])).rows;
  const notifications=(await pool.query('SELECT status,channel,COUNT(*)::int count FROM Notifications WHERE activity_id=$1 GROUP BY status,channel ORDER BY status,channel',[a.id])).rows;
  let preparedWhatsapp=[];
  if(a.effective_owner===req.userId){
    const prepared=(await pool.query(`SELECT n.id,p.id participant_id,g.phone,a.name,n.delivery_url,COALESCE(ru.name,rg.name) recipient_name
      FROM Notifications n JOIN Activities a ON a.id=n.activity_id JOIN ActivityParticipants p ON p.id=n.participant_id JOIN Guests g ON g.id=p.guest_id
      LEFT JOIN ActivityParticipants r ON r.id=p.recipient_participant_id LEFT JOIN Users ru ON ru.id=r.user_id LEFT JOIN Guests rg ON rg.id=r.guest_id
      WHERE n.activity_id=$1 AND n.channel='whatsapp' AND n.status='prepared'`,[a.id])).rows;
    preparedWhatsapp=prepared.map(buildPreparedWhatsapp);
  }
  const winner=(await pool.query(`SELECT w.participant_id,w.number,COALESCE(u.name,g.name) name FROM ActivityParticipantWinners w JOIN ActivityParticipants p ON p.id=w.participant_id LEFT JOIN Users u ON u.id=p.user_id LEFT JOIN Guests g ON g.id=p.guest_id WHERE w.activity_id=$1`,[a.id])).rows[0]||null;
  res.json({...a,participants,transactions,products:products.map(p=>({...p,stock:Number(p.stock)})),notifications,preparedWhatsapp,winner,summary:{income:Number(totals.income),costs:Number(totals.costs),adjustments:Number(totals.adjustments),net:Number(totals.income)-Number(totals.costs)+Number(totals.adjustments)}});
});

router.post('/activities/:id/invitations', async (req,res) => {
  const { participantId } = req.body;
  try {
    const result=await tx(async db=>{
      const a=await getActivity(db,req.params.id,{userId:req.userId},true);
      if(!a||a.effective_owner!==req.userId)throw new Error('No autorizado');
      const p=(await db.query(`SELECT p.*,g.name,g.email,g.phone FROM ActivityParticipants p JOIN Guests g ON g.id=p.guest_id WHERE p.id=$1 AND p.activity_id=$2`,[participantId,a.id])).rows[0];
      if(!p)throw new Error('El participante no es un invitado');
      const raw=crypto.randomBytes(32).toString('hex');
      const invitation=(await db.query("INSERT INTO Invitations(scope_type,scope_id,guest_id,token_hash,expires_at,created_by) VALUES('activity',$1,$2,$3,NOW()+INTERVAL '7 days',$4) RETURNING id,expires_at",[a.id,p.guest_id,hashToken(raw),req.userId])).rows[0];
      return { invitation, raw, participant:p, activity:a };
    });
    const claimUrl=`${frontendUrl()}/invitacion?token=${result.raw}`;
    let emailStatus='not_applicable';
    if(result.participant.email){try{await sendInvitationEmail(result.participant.email,{activityName:result.activity.name,claimUrl});emailStatus='sent';}catch(error){emailStatus='failed';console.error('No se pudo enviar invitación:',error.message);}}
    const whatsappUrl=result.participant.phone?`https://wa.me/${result.participant.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Te invitaron a ${result.activity.name} en Mi Vaquita. Abre ${claimUrl}`)}`:null;
    res.status(201).json({id:result.invitation.id,expiresAt:result.invitation.expires_at,emailStatus,whatsappUrl});
  }catch(error){fail(res,error.message,error.message==='No autorizado'?403:400);}
});

router.put('/activities/:id/exclusions', async(req,res)=>{
  const { participantId, excludedParticipantIds=[] }=req.body;
  if(!Number.isInteger(Number(participantId))||!Array.isArray(excludedParticipantIds))return fail(res,'Exclusiones inválidas');
  try{await tx(async db=>{
    const a=await getActivity(db,req.params.id,{userId:req.userId},true);if(!a||a.status!=='draft'||a.type!=='secret_santa')throw new Error('El sorteo ya no admite cambios');
    const all=(await db.query('SELECT id,user_id FROM ActivityParticipants WHERE activity_id=$1',[a.id])).rows,ids=all.map(x=>x.id);
    const own=all.find(x=>x.user_id===req.userId)?.id;
    if(a.effective_owner!==req.userId&&Number(participantId)!==own)throw new Error('Solo puedes cambiar tus propias exclusiones');
    if(!ids.includes(Number(participantId))||excludedParticipantIds.some(x=>!ids.includes(Number(x))||Number(x)===Number(participantId)))throw new Error('Exclusión inválida');
    await db.query('DELETE FROM ActivityParticipantExclusions WHERE activity_id=$1 AND participant_id=$2',[a.id,participantId]);
    for(const id of new Set(excludedParticipantIds.map(Number)))await db.query('INSERT INTO ActivityParticipantExclusions(activity_id,participant_id,excluded_participant_id) VALUES($1,$2,$3)',[a.id,participantId,id]);
  });res.json({ok:true});}catch(error){fail(res,error.message);}
});

async function deliverAssignments(activityId, onlyFailed=false){
  const rows=(await pool.query(`SELECT n.id notification_id,n.channel,n.delivery_url,p.id participant_id,COALESCE(u.email,g.email) email,g.phone,a.name,a.event_on,a.budget,COALESCE(ru.name,rg.name) recipient_name
    FROM Notifications n JOIN Activities a ON a.id=n.activity_id JOIN ActivityParticipants p ON p.id=n.participant_id
    LEFT JOIN Users u ON u.id=p.user_id LEFT JOIN Guests g ON g.id=p.guest_id
    LEFT JOIN ActivityParticipants r ON r.id=p.recipient_participant_id LEFT JOIN Users ru ON ru.id=r.user_id LEFT JOIN Guests rg ON rg.id=r.guest_id
    WHERE n.activity_id=$1 AND n.status ${onlyFailed?"IN ('pending','failed')":"='pending'"}`,[activityId])).rows;
  const output=[];
  for(const row of rows){
    const decryptedUrl=decryptDeliveryUrl(row.delivery_url);
    if(row.channel==='whatsapp'){
      const privateUrl=decryptedUrl||`${frontendUrl()}/actividades/${activityId}/privado`;
      const text=`En ${row.name}, te tocó ${row.recipient_name}. Mira tu asignación privada: ${privateUrl}`;
      output.push({participantId:row.participant_id,whatsappUrl:`https://wa.me/${String(row.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent(text)}`});
      await pool.query("UPDATE Notifications SET status='prepared',attempts=attempts+1,last_error=NULL WHERE id=$1",[row.notification_id]);
    }else try{
      await sendSecretSantaEmail(row.email,{activityName:row.name,recipientName:row.recipient_name,eventOn:row.event_on,budget:row.budget,privateUrl:decryptedUrl||`${frontendUrl()}/actividades/${activityId}/privado`});
      await pool.query("UPDATE Notifications SET status='sent',attempts=attempts+1,sent_at=NOW(),last_error=NULL WHERE id=$1",[row.notification_id]);
    }catch(error){await pool.query("UPDATE Notifications SET status='failed',attempts=attempts+1,last_error=$2 WHERE id=$1",[row.notification_id,error.message.slice(0,500)]);}
  }
  return output;
}

router.post('/activities/:id/draw',async(req,res)=>{
  try{
    const result=await tx(async db=>{
      const a=await getActivity(db,req.params.id,{userId:req.userId},true);
      if(!a||a.effective_owner!==req.userId||a.status!=='draft'||!['secret_santa','raffle'].includes(a.type))throw new Error('Sorteo no permitido o ya realizado');
      const participants=(await db.query('SELECT id,user_id,guest_id FROM ActivityParticipants WHERE activity_id=$1 ORDER BY id',[a.id])).rows;
      if(a.type==='raffle'){
        const assigned=(await db.query('SELECT id,user_id,guest_id,number FROM ActivityParticipants WHERE activity_id=$1 AND number IS NOT NULL ORDER BY id',[a.id])).rows;
        if(!assigned.length)throw new Error('Asigna al menos un número antes del sorteo');
        const winner=assigned[crypto.randomInt(assigned.length)];await db.query('INSERT INTO ActivityParticipantWinners(activity_id,participant_id,number) VALUES($1,$2,$3)',[a.id,winner.id,winner.number]);await db.query("UPDATE Activities SET status='drawn' WHERE id=$1",[a.id]);return {...a,winner};
      }
      if(participants.length<2)throw new Error('Se necesitan al menos dos participantes');
      const exclusions=(await db.query('SELECT participant_id AS user_id,excluded_participant_id AS excluded_user_id FROM ActivityParticipantExclusions WHERE activity_id=$1',[a.id])).rows;
      const assignment=matching(participants.map(p=>p.id),exclusions);if(!assignment)throw new Error('Las exclusiones impiden un sorteo válido');
      for(const [from,to] of assignment)await db.query('UPDATE ActivityParticipants SET recipient_participant_id=$1 WHERE id=$2',[to,from]);
      for(const p of participants){
        const contact=(await db.query('SELECT u.email,g.email AS guest_email,g.phone FROM ActivityParticipants p LEFT JOIN Users u ON u.id=p.user_id LEFT JOIN Guests g ON g.id=p.guest_id WHERE p.id=$1',[p.id])).rows[0];
        const channel=(contact.email||contact.guest_email)?'email':'whatsapp';let deliveryUrl=`${frontendUrl()}/actividades/${a.id}/privado`;
        if(p.guest_id){const raw=crypto.randomBytes(32).toString('hex');await db.query("INSERT INTO Invitations(scope_type,scope_id,guest_id,token_hash,expires_at,created_by) VALUES('activity',$1,$2,$3,NOW()+INTERVAL '7 days',$4)",[a.id,p.guest_id,hashToken(raw),req.userId]);deliveryUrl=`${frontendUrl()}/invitacion?token=${raw}&next=${encodeURIComponent(`/actividades/${a.id}/privado`)}`;}
        await db.query("INSERT INTO Notifications(activity_id,participant_id,kind,channel,idempotency_key,delivery_url) VALUES($1,$2,'secret_santa_assignment',$3,$4,$5)",[a.id,p.id,channel,`secret-santa:${a.id}:${p.id}`,encryptDeliveryUrl(deliveryUrl)]);
      }
      await db.query("UPDATE Activities SET status='drawn' WHERE id=$1",[a.id]);
      return a;
    });
    if(result.type==='raffle')return res.json({status:'drawn',winner:{participantId:result.winner.id,number:result.winner.number}});
    const whatsapp=await deliverAssignments(result.id);
    const notifications=(await pool.query('SELECT status,COUNT(*)::int count FROM Notifications WHERE activity_id=$1 GROUP BY status',[result.id])).rows;
    res.json({status:'drawn',notifications,whatsapp});
  }catch(error){fail(res,error.message);}
});

router.put('/activities/:id/numbers',async(req,res)=>{
  const assignments=req.body.assignments;
  if(!Array.isArray(assignments)||assignments.some(x=>!Number.isInteger(Number(x.participantId))||!Number.isInteger(Number(x.number))||Number(x.number)<0)||new Set(assignments.map(x=>Number(x.number))).size!==assignments.length)return fail(res,'Números inválidos o repetidos');
  try{await tx(async db=>{const a=await getActivity(db,req.params.id,{userId:req.userId},true);if(!a||a.effective_owner!==req.userId||a.type!=='raffle'||a.status!=='draft')throw new Error('No puedes cambiar los números');const ids=(await db.query('SELECT id FROM ActivityParticipants WHERE activity_id=$1',[a.id])).rows.map(x=>x.id);if(assignments.some(x=>!ids.includes(Number(x.participantId)))||new Set(assignments.map(x=>Number(x.participantId))).size!==assignments.length)throw new Error('Participantes inválidos');await db.query('UPDATE ActivityParticipants SET number=NULL WHERE activity_id=$1',[a.id]);for(const x of assignments)await db.query('UPDATE ActivityParticipants SET number=$1 WHERE id=$2',[Number(x.number),Number(x.participantId)]);});res.json({ok:true});}catch(error){fail(res,error.message);}
});

router.post('/activities/:id/notifications/retry',async(req,res)=>{
  const a=await getActivity(pool,req.params.id,{userId:req.userId});
  if(!a||a.effective_owner!==req.userId)return fail(res,'No autorizado',403);
  const whatsapp=await deliverAssignments(a.id,true);
  const notifications=(await pool.query('SELECT status,COUNT(*)::int count FROM Notifications WHERE activity_id=$1 GROUP BY status',[a.id])).rows;
  res.json({notifications,whatsapp});
});

router.post('/activities/:id/transactions',async(req,res)=>{
  const {kind,description,amount,receiptUrl=null}=req.body;
  if(!['income','cost','expense','adjustment'].includes(kind)||!String(description||'').trim()||!(Number(amount)>0))return fail(res,'Movimiento inválido');
  const a=await getActivity(pool,req.params.id,{userId:req.userId});if(!a||(!a.participant_manager&&a.effective_owner!==req.userId)||a.reconciled_at)return fail(res,'No puedes registrar este movimiento',403);
  const row=(await pool.query('INSERT INTO FundraisingTransactions(activity_id,kind,description,amount,receipt_url,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[a.id,kind,description.trim(),Number(amount),receiptUrl,req.userId])).rows[0];res.status(201).json(row);
});

router.post('/activities/:id/products',async(req,res)=>{
  const {name,unit='unidad',costPrice=0,salePrice=0,initialQuantity=0}=req.body;
  if(!String(name||'').trim()||[costPrice,salePrice,initialQuantity].some(x=>Number(x)<0))return fail(res,'Producto inválido');
  try{const row=await tx(async db=>{const a=await getActivity(db,req.params.id,{userId:req.userId},true);if(!a||(!a.participant_manager&&a.effective_owner!==req.userId)||a.reconciled_at||!['sale','bazaar','food'].includes(a.type))throw new Error('La actividad no admite inventario');const p=(await db.query('INSERT INTO InventoryProducts(activity_id,name,unit,cost_price,sale_price) VALUES($1,$2,$3,$4,$5) RETURNING *',[a.id,name.trim(),unit,Number(costPrice),Number(salePrice)])).rows[0];if(Number(initialQuantity)>0)await db.query("INSERT INTO InventoryMovements(product_id,kind,quantity,unit_price,note,recorded_by) VALUES($1,'initial',$2,$3,'Inventario inicial',$4)",[p.id,Number(initialQuantity),Number(costPrice),req.userId]);return p;});res.status(201).json(row);}catch(error){fail(res,error.message);}
});

router.post('/activities/:id/products/:productId/movements',async(req,res)=>{
  const {kind,quantity,unitPrice=null,note=null}=req.body;
  if(!['entry','sale','loss','adjustment'].includes(kind)||!Number(quantity))return fail(res,'Movimiento de inventario inválido');
  try{const row=await tx(async db=>{const a=await getActivity(db,req.params.id,{userId:req.userId},true);if(!a||(!a.participant_manager&&a.effective_owner!==req.userId)||a.reconciled_at)throw new Error('No autorizado');const p=(await db.query('SELECT * FROM InventoryProducts WHERE id=$1 AND activity_id=$2',[req.params.productId,a.id])).rows[0];if(!p)throw new Error('Producto no encontrado');const signed=['sale','loss'].includes(kind)?-Math.abs(Number(quantity)):Number(quantity);const stock=Number((await db.query('SELECT COALESCE(SUM(quantity),0) stock FROM InventoryMovements WHERE product_id=$1',[p.id])).rows[0].stock);if(stock+signed<0)throw new Error('No hay inventario suficiente');return (await db.query('INSERT INTO InventoryMovements(product_id,kind,quantity,unit_price,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[p.id,kind,signed,unitPrice,note,req.userId])).rows[0];});res.status(201).json(row);}catch(error){fail(res,error.message);}
});

router.post('/activities/:id/reconcile',async(req,res)=>{
  try{const result=await tx(async db=>{const a=await getActivity(db,req.params.id,{userId:req.userId},true);if(!a||a.effective_owner!==req.userId||a.reconciled_at)throw new Error('No puedes conciliar esta actividad');const openStock=(await db.query("SELECT COUNT(*)::int count FROM InventoryProducts p WHERE p.activity_id=$1 AND COALESCE((SELECT SUM(quantity) FROM InventoryMovements m WHERE m.product_id=p.id),0)<>0",[a.id])).rows[0].count;if(openStock)throw new Error('Concilia el inventario antes de cerrar');const t=(await db.query("SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount WHEN kind IN ('cost','expense') THEN -amount WHEN kind='adjustment' THEN amount ELSE 0 END),0) net FROM FundraisingTransactions WHERE activity_id=$1 AND reversed_transaction_id IS NULL",[a.id])).rows[0];if(a.natillera_id&&Number(t.net)!==0)await db.query("INSERT INTO NatilleraLedger(natillera_id,activity_id,kind,amount,description,recorded_by) VALUES($1,$2,'activity_profit',$3,$4,$5)",[a.natillera_id,a.id,t.net,`Utilidad de ${a.name}`,req.userId]);await db.query("UPDATE Activities SET reconciled_at=NOW(),status='closed' WHERE id=$1",[a.id]);return {net:Number(t.net),status:'closed'};});res.json(result);}catch(error){fail(res,error.message);}
});

export default router;
