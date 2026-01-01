import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { connectDB } from './config/db.js';
import webhookRoutes from './routes/webhookRoutes.js';
import authRoutes from './routes/authRoutes.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth/webhook', webhookRoutes);
app.use('/auth', authRoutes);
app.use('/', (req, res) => res.json({ ok: true }));
const port = Number(process.env.PORT || 3000);

await connectDB(process.env.MONGODB_URI);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Auth middleware service listening on http://localhost:${port}`);
});
