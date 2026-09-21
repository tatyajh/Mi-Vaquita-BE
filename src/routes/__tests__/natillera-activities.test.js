import { dueDates, buildParticipantSchedule } from '../natilleras.router.js';
import { matching } from '../activities.router.js';
import natilleraRouter from '../natilleras.router.js';
import activityRouter from '../activities.router.js';
import express from 'express';
import request from 'supertest';

it('protege todas las rutas nuevas con autenticación', async () => {
  const app=express();app.use('/natilleras',natilleraRouter);app.use('/activities',activityRouter);
  expect((await request(app).get('/natilleras')).status).toBe(401);
  expect((await request(app).post('/natilleras')).status).toBe(401);
  expect((await request(app).get('/activities/group/1')).status).toBe(401);
  expect((await request(app).post('/activities/1/draw')).status).toBe(401);
});

describe('cronograma de natillera', () => {
  it('mantiene el día original cuando febrero acorta el mes', () => {
    expect(dueDates({starts_on:'2026-01-31',ends_on:'2026-04-30',frequency:'monthly'}))
      .toEqual(['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
  });
  it('genera cuotas semanales sin pasar la fecha final', () => {
    expect(dueDates({starts_on:'2026-09-01',ends_on:'2026-09-16',frequency:'weekly'}))
      .toEqual(['2026-09-01','2026-09-08','2026-09-15']);
  });
  it('hace exigibles las cuotas ordinarias de invitados y reconoce pagos vinculados',()=>{
    const participants=[{participant_id:8,guest_id:3,name:'Invitada'}];
    const quotas=[{id:4,kind:'ordinary',audience:'guests',due_on:'2026-09-01',amount:'50000'}];
    expect(buildParticipantSchedule(participants,quotas,[],'2026-09-21')[0]).toMatchObject({balance:50000,status:'overdue'});
    expect(buildParticipantSchedule(participants,quotas,[{participant_id:8,quota_id:4,paid:'50000'}],'2026-09-21')[0]).toMatchObject({balance:0,status:'paid'});
  });
});

describe('amigo secreto', () => {
  it('no asigna a nadie consigo mismo ni repite destinatarios', () => {
    const result=matching([1,2,3,4],[]);
    expect(result.size).toBe(4);
    expect(new Set(result.values()).size).toBe(4);
    for(const [from,to] of result)expect(from).not.toBe(to);
  });
  it('respeta exclusiones y detecta sorteos imposibles', () => {
    const exclusions=[{user_id:1,excluded_user_id:2}];
    const result=matching([1,2,3],exclusions);
    expect(result.get(1)).toBe(3);
    expect(matching([1,2],[{user_id:1,excluded_user_id:2}])).toBeNull();
  });
});
