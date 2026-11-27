import express from 'express';
import cors from 'cors';
import { config } from './config';
import { migrate } from './db';
import { payments } from './routes/payments';
import { ipfs } from './routes/ipfs';
import { misc } from './routes/misc';
import { errorHandler } from './http';
import { startWorker } from './oracle';
import { startListener } from './listener';
import { startReconciler } from './reconciler';

async function main() {
  await migrate();
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: [config.frontendUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/payments', payments);
  app.use('/api/ipfs', ipfs);
  app.use('/api', misc);
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  startWorker();
  startListener();
  startReconciler();
  app.listen(config.port, () => {
    console.log(`[oracle] API di :${config.port} | payment mode: ${config.midtrans.mode} | RPC: ${config.rpcUrls.join(', ')}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
