import Router from 'express-promise-router';
import pool from '../lib/connection.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { dispatchReminders, ensureReminders, getCalendarEvents } from '../services/calendar.service.js';

const router=Router();
router.get('/dispatch',async(req,res)=>{
  if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return res.status(401).json({message:'No autorizado'});
  res.json(await dispatchReminders());
});
router.use(authenticateJWT);
router.get('/',async(req,res)=>{
  const start=/^\d{4}-\d{2}-\d{2}$/.test(req.query.start||'')?req.query.start:undefined;
  const end=/^\d{4}-\d{2}-\d{2}$/.test(req.query.end||'')?req.query.end:undefined;
  const reminders=await ensureReminders(req.userId);
  const preferences=(await pool.query('SELECT * FROM ReminderPreferences WHERE user_id=$1',[req.userId])).rows[0];
  res.json({events:await getCalendarEvents(req.userId,{start,end}),reminders:preferences.in_app_enabled?reminders.filter(x=>!x.read_at):[],preferences});
});
router.put('/preferences',async(req,res)=>{
  const {inAppEnabled=true,emailEnabled=true}=req.body;
  const row=(await pool.query(`INSERT INTO ReminderPreferences(user_id,in_app_enabled,email_enabled) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET in_app_enabled=$2,email_enabled=$3,updated_at=NOW() RETURNING *`,[req.userId,Boolean(inAppEnabled),Boolean(emailEnabled)])).rows[0];res.json(row);
});
router.post('/reminders/:id/read',async(req,res)=>{const row=(await pool.query('UPDATE CalendarReminders SET read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.userId])).rows[0];if(!row)return res.status(404).json({message:'Aviso no encontrado'});res.json({ok:true});});
export default router;
