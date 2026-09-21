import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
// Side-effect import: runs the idempotent CREATE TABLE/ALTER TABLE
// statements in migrations.js on boot. Nothing in the codebase
// imported this file before, so none of its migrations (including
// prior fixes to the Friends table) ever actually ran in production.
import { migrationsReady } from './utils/migrations.js';
import groupRoutes from './routes/groups.router.js';
import userRoutes from './routes/users.router.js';
import authRoutes from './routes/auth.router.js'; 
import friendRoutes from './routes/friends.router.js';
import expenseRoutes from './routes/expenses.router.js';
import natilleraRoutes from './routes/natilleras.router.js';
import activityRoutes from './routes/activities.router.js';
import communityRoutes from './routes/community.router.js';
import billingRoutes from './routes/billing.router.js';
import calendarRoutes from './routes/calendar.router.js';

const app = express();
await migrationsReady;
const allowedOrigins = [process.env.FRONTEND_URL, ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000','http://127.0.0.1:3000'])].filter(Boolean).map(x=>x.replace(/\/$/,''));
app.use(cors({ origin(origin,callback){ if(!origin||allowedOrigins.includes(origin.replace(/\/$/,'')))return callback(null,true); callback(new Error('Origen no permitido por CORS')); } }));
// crossOriginResourcePolicy en 'cross-origin': el frontend en otro origen
// (mi-vaquita-fe.vercel.app) necesita poder leer las respuestas de esta API;
// el default 'same-origin' de helmet las bloquearía.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  console.log(`Request: ${req.method} ${req.url}`);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes); 
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/natilleras', natilleraRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/calendar', calendarRoutes);

// En Vercel el runtime de Node maneja el request/response
// directamente sobre `app` (export default) — llamar a listen() ahí
// no tiene efecto y además falla el build serverless.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
