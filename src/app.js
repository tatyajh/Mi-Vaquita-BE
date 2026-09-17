import express from 'express';
import cors from 'cors';
import groupRoutes from './routes/groups.router.js'; 
import userRoutes from './routes/users.router.js';
import authRoutes from './routes/auth.router.js'; 
import friendRoutes from './routes/friends.router.js';
import expenseRoutes from './routes/expenses.router.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`Request: ${req.method} ${req.url}`);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes); 
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/expenses', expenseRoutes);

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
