import express from 'express';
import request from 'supertest';
import communityRouter, { buildPreparedWhatsapp, encryptDeliveryUrl, decryptDeliveryUrl } from '../community.router.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';
import { sendTransactionalEmail } from '../../services/email.service.js';

it('protege las actividades, recaudos e inventario independientes', async()=>{
  const app=express();app.use(express.json());app.use('/community',communityRouter);
  expect((await request(app).get('/community/activities')).status).toBe(401);
  expect((await request(app).post('/community/activities/1/transactions').send({})).status).toBe(401);
  expect((await request(app).put('/community/activities/1/numbers').send({assignments:[]})).status).toBe(401);
});

it('limita intentos repetidos por IP y ruta',async()=>{
  const app=express();app.post('/pin',rateLimit({max:2,windowMs:60_000}),(req,res)=>res.json({ok:true}));
  expect((await request(app).post('/pin')).status).toBe(200);
  expect((await request(app).post('/pin')).status).toBe(200);
  expect((await request(app).post('/pin')).status).toBe(429);
});

it('falla explícitamente si el proveedor de correo no está configurado',async()=>{
  const oldKey=process.env.RESEND_API_KEY,oldFrom=process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;delete process.env.RESEND_FROM_EMAIL;
  await expect(sendTransactionalEmail({to:'persona@example.com',subject:'Prueba',html:'hola'})).rejects.toMatchObject({code:'EMAIL_NOT_CONFIGURED'});
  if(oldKey)process.env.RESEND_API_KEY=oldKey;if(oldFrom)process.env.RESEND_FROM_EMAIL=oldFrom;
});

it('conserva un enlace manual de WhatsApp utilizable después del sorteo',()=>{
  const plain='https://mi-vaquita.test/invitacion?token=privado',encrypted=encryptDeliveryUrl(plain,'secreto-prueba');
  expect(encrypted).not.toContain('token=');
  expect(decryptDeliveryUrl(encrypted,'secreto-prueba')).toBe(plain);
  const oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET='secreto-prueba';
  const result=buildPreparedWhatsapp({id:7,participant_id:9,phone:'+57 300 123 4567',name:'Navidad',recipient_name:'Ana',delivery_url:encrypted});
  if(oldSecret)process.env.JWT_SECRET=oldSecret;else delete process.env.JWT_SECRET;
  expect(result.notificationId).toBe(7);
  expect(result.whatsappUrl).toContain('https://wa.me/573001234567?text=');
  expect(decodeURIComponent(result.whatsappUrl)).not.toContain('Ana');
  expect(decodeURIComponent(result.whatsappUrl)).toContain('El resultado no aparece en este mensaje');
  expect(decodeURIComponent(result.whatsappUrl)).toContain('token=privado');
});
