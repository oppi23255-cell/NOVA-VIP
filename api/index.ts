import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHostingApp } from '../server/app.ts';

let appPromise: ReturnType<typeof createHostingApp> | null = null;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!appPromise) {
    appPromise = createHostingApp({ attachVite: false, serveDist: false });
  }
  const app = await appPromise;
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
