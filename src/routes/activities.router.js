import Router from 'express-promise-router';
import { randomInt } from 'node:crypto';
import pool from '../lib/connection.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router=Router();
router.use(authenticateJWT);
const fail=(res,message,status=400)=>res.status(status).json({message});
async function access(db,groupId,userId){
  return (await db.query('SELECT g.*,EXISTS(SELECT 1 FROM GroupParticipants p WHERE p.group_id=g.id AND p.user_id=$2) AS member FROM Groups g WHERE g.id=$1',[groupId,userId])).rows[0];
}
async function activity(db,id,userId,lock=false){
  const {rows}=await db.query(`SELECT a.*,to_char(a.event_on,'YYYY-MM-DD') AS event_on,g.owneruserid AS owner_id,EXISTS(SELECT 1 FROM GroupParticipants p WHERE p.group_id=a.group_id AND p.user_id=$2) AS member FROM Activities a JOIN Groups g ON g.id=a.group_id WHERE a.id=$1 ${lock?'FOR UPDATE OF a':''}`,[id,userId]);
  return rows[0];
}
async function tx(fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
export function matching(ids, excluded){
  const choices=new Map(ids.map(id=>[id,ids.filter(to=>to!==id&&!excluded.some(e=>e.user_id===id&&e.excluded_user_id===to))]));
  const order=[...ids].sort((a,b)=>choices.get(a).length-choices.get(b).length);
  const result=new Map(), used=new Set();
  function search(i){if(i===order.length)return true;const from=order[i], options=[...choices.get(from)];for(let j=options.length-1;j>0;j--){const k=randomInt(j+1);[options[j],options[k]]=[options[k],options[j]];}for(const to of options){if(used.has(to))continue;used.add(to);result.set(from,to);if(search(i+1))return true;used.delete(to);result.delete(from);}return false;}
  return search(0)?result:null;
}
router.get('/group/:groupId',async(req,res)=>{
  const g=await access(pool,req.params.groupId,req.userId);
  if(!g||(!g.member&&g.owneruserid!==req.userId))return fail(res,'Grupo no encontrado',404);
  const {rows}=await pool.query("SELECT id,group_id,type,name,to_char(event_on,'YYYY-MM-DD') AS event_on,budget,status,created_at FROM Activities WHERE group_id=$1 ORDER BY created_at DESC",[g.id]);res.json(rows);
});
router.post('/group/:groupId',async(req,res)=>{
  const g=await access(pool,req.params.groupId,req.userId);
  if(!g||g.owneruserid!==req.userId)return fail(res,'Solo quien administra el grupo puede crear actividades',403);
  const {type,name,eventOn,budget}=req.body;
  if(!['secret_santa','raffle'].includes(type)||!name?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(eventOn||'')||type==='secret_santa'&&(budget==null||Number(budget)<0))return fail(res,'Datos de actividad inválidos');
  try{const result=await tx(async db=>{
    const row=(await db.query('INSERT INTO Activities(group_id,type,name,event_on,budget,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[g.id,type,name.trim(),eventOn,type==='secret_santa'?Number(budget):null,req.userId])).rows[0];
    const members=(await db.query('SELECT user_id FROM GroupParticipants WHERE group_id=$1',[g.id])).rows;
    for(const userId of new Set([g.owneruserid,...members.map(m=>m.user_id)]))await db.query('INSERT INTO ActivityMembers(activity_id,user_id) VALUES($1,$2)',[row.id,userId]);
    return row;
  });res.status(201).json(result);}catch(e){fail(res,e.message);}
});
router.get('/:id',async(req,res)=>{
  const a=await activity(pool,req.params.id,req.userId);
  if(!a||(!a.member&&a.owner_id!==req.userId))return fail(res,'Actividad no encontrada',404);
  const members=(await pool.query('SELECT u.id,u.name,m.number FROM ActivityMembers m JOIN Users u ON u.id=m.user_id WHERE m.activity_id=$1 ORDER BY u.name',[a.id])).rows;
  const mine=(await pool.query('SELECT m.recipient_id,u.name AS recipient_name,m.number FROM ActivityMembers m LEFT JOIN Users u ON u.id=m.recipient_id WHERE m.activity_id=$1 AND m.user_id=$2',[a.id,req.userId])).rows[0]||null;
  const exclusions=(await pool.query('SELECT excluded_user_id FROM ActivityExclusions WHERE activity_id=$1 AND user_id=$2',[a.id,req.userId])).rows.map(r=>r.excluded_user_id);
  const winner=(await pool.query('SELECT w.number,u.name FROM ActivityWinners w JOIN Users u ON u.id=w.user_id WHERE w.activity_id=$1',[a.id])).rows[0]||null;
  res.json({id:a.id,groupId:a.group_id,type:a.type,name:a.name,eventOn:a.event_on,budget:a.budget,status:a.status,isAdmin:a.owner_id===req.userId,members,myRecipient:mine?.recipient_id?{id:mine.recipient_id,name:mine.recipient_name}:null,myNumber:mine?.number,exclusions,winner});
});
router.put('/:id/exclusions',async(req,res)=>{
  const ids=req.body.excludedUserIds;
  if(!Array.isArray(ids)||ids.some(id=>!Number.isInteger(Number(id))))return fail(res,'Exclusiones inválidas');
  try{await tx(async db=>{
    const a=await activity(db,req.params.id,req.userId,true);
    if(!a||a.type!=='secret_santa'||a.status!=='draft')throw new Error('El sorteo ya fue realizado');
    const members=(await db.query('SELECT user_id FROM ActivityMembers WHERE activity_id=$1',[a.id])).rows.map(r=>r.user_id);
    if(!members.includes(req.userId)||ids.some(id=>Number(id)===req.userId||!members.includes(Number(id))))throw new Error('Exclusión inválida');
    await db.query('DELETE FROM ActivityExclusions WHERE activity_id=$1 AND user_id=$2',[a.id,req.userId]);
    for(const id of new Set(ids.map(Number)))await db.query('INSERT INTO ActivityExclusions(activity_id,user_id,excluded_user_id) VALUES($1,$2,$3)',[a.id,req.userId,id]);
  });res.json({ok:true});}catch(e){fail(res,e.message);}
});
router.post('/:id/draw',async(req,res)=>{
  try{const result=await tx(async db=>{
    const a=await activity(db,req.params.id,req.userId,true);
    if(!a||a.owner_id!==req.userId||a.status!=='draft')throw new Error('Sorteo no permitido o ya realizado');
    const members=(await db.query('SELECT user_id,number FROM ActivityMembers WHERE activity_id=$1 ORDER BY user_id',[a.id])).rows;
    if(a.type==='secret_santa'){
      if(members.length<2)throw new Error('Se necesitan al menos dos participantes');
      const exclusions=(await db.query('SELECT user_id,excluded_user_id FROM ActivityExclusions WHERE activity_id=$1',[a.id])).rows;
      const result=matching(members.map(m=>m.user_id),exclusions);
      if(!result)throw new Error('Las exclusiones impiden un sorteo válido');
      for(const [from,to] of result)await db.query('UPDATE ActivityMembers SET recipient_id=$1 WHERE activity_id=$2 AND user_id=$3',[to,a.id,from]);
      await db.query("UPDATE Activities SET status='drawn' WHERE id=$1",[a.id]);
      return {status:'drawn'};
    }
    const assigned=members.filter(m=>m.number!=null);
    if(!assigned.length)throw new Error('Asigna al menos un número antes del sorteo');
    const selected=assigned[randomInt(assigned.length)];
    await db.query('INSERT INTO ActivityWinners(activity_id,user_id,number) VALUES($1,$2,$3)',[a.id,selected.user_id,selected.number]);
    await db.query("UPDATE Activities SET status='drawn' WHERE id=$1",[a.id]);
    return {status:'drawn',winner:{userId:selected.user_id,number:selected.number}};
  });res.json(result);}catch(e){fail(res,e.message);}
});
router.put('/:id/numbers',async(req,res)=>{
  const assignments=req.body.assignments;
  if(!Array.isArray(assignments)||assignments.some(x=>!Number.isInteger(Number(x.userId))||!Number.isInteger(Number(x.number))||Number(x.number)<0)||new Set(assignments.map(x=>Number(x.number))).size!==assignments.length)return fail(res,'Números inválidos o repetidos');
  try{await tx(async db=>{
    const a=await activity(db,req.params.id,req.userId,true);
    if(!a||a.owner_id!==req.userId||a.type!=='raffle'||a.status!=='draft')throw new Error('No puedes cambiar los números');
    const ids=(await db.query('SELECT user_id FROM ActivityMembers WHERE activity_id=$1',[a.id])).rows.map(r=>r.user_id);
    if(assignments.some(x=>!ids.includes(Number(x.userId)))||new Set(assignments.map(x=>Number(x.userId))).size!==assignments.length)throw new Error('Participantes inválidos');
    await db.query('UPDATE ActivityMembers SET number=NULL WHERE activity_id=$1',[a.id]);
    for(const x of assignments)await db.query('UPDATE ActivityMembers SET number=$1 WHERE activity_id=$2 AND user_id=$3',[x.number,a.id,x.userId]);
  });res.json({ok:true});}catch(e){fail(res,e.message);}
});
export default router;
