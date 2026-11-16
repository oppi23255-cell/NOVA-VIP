import dotenv from 'dotenv';
import { createHostingApp } from './server/app.ts';
import { restoreActiveProcesses } from './server/deployer.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer(): Promise<void> {
  const app = await createHostingApp({
    attachVite: !IS_PROD,
    serveDist: IS_PROD,
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Modif Hosting Server running on http://0.0.0.0:${PORT}`);
    restoreActiveProcesses();
  });
}

void startServer();
