import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  appendFolderBatchToSession,
  appendZipChunkToSession,
  createOrReplaceSiteFromUpload,
  createSiteZipBuffer,
  createUploadSession,
  deleteSite,
  deployFromUploadSession,
  extractZipToSite,
  fetchGitHubRepoZipBuffer,
  finalizeAndInspectSession,
  getSiteByDomain,
  getSiteById,
  listSiteFiles,
  loadSites,
  normalizeDomain,
  readSiteFileContent,
  serveRefererAssetIfMatched,
  serveSiteHttp,
  stopSiteProcess,
  triggerSiteBuild,
  updateSiteDomain,
  waitForBuildInitial,
  writeUploadedFilesToSite,
} from './deployer.ts';
import { detectProject, getRuntimeCapabilities } from './detector.ts';
import { STARTER_TEMPLATES } from './templates.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 150 * 1024 * 1024,
    files: 2500,
  },
});

function getControlPanelHost(): string {
  if (process.env.PANEL_DOMAIN) {
    return normalizeDomain(process.env.PANEL_DOMAIN);
  }
  const appUrl = process.env.APP_URL || '';
  try {
    return appUrl ? new URL(appUrl).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function getServerNetworkIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name] || [];
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

let cachedPublicIp: string | null = null;
async function getPublicServerIp(): Promise<string> {
  if (process.env.PUBLIC_IP) return process.env.PUBLIC_IP.trim();
  if (cachedPublicIp) return cachedPublicIp;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch('https://api.ipify.org', { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const ip = (await resp.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        cachedPublicIp = ip;
        return ip;
      }
    }
  } catch {
    // ignore offline fallback
  }
  return getServerNetworkIp();
}

export interface CreateHostingAppOptions {
  attachVite?: boolean;
  serveDist?: boolean;
}

export async function createHostingApp(
  options: CreateHostingAppOptions = {},
): Promise<express.Express> {
  const app = express();
  app.set('trust proxy', true);

  // 1. Custom Domain Host-Header Routing (isolates custom domains across ALL paths including /api/*)
  app.use((req, res, next) => {
    const rawHost = String(
      req.headers['x-forwarded-host'] || req.headers.host || '',
    );
    const hostname = normalizeDomain(rawHost.split(',')[0] || '');
    const panelHost = getControlPanelHost();

    const isControlPanelHost =
      !hostname ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === panelHost ||
      hostname.endsWith('.run.app') ||
      hostname.endsWith('.vercel.app');

    if (!isControlPanelHost) {
      const matchedSite = getSiteByDomain(hostname);
      if (matchedSite) {
        return serveSiteHttp(matchedSite, req, res, req.originalUrl || '/', '/');
      }
    }
    return next();
  });

  // 2. Internal Preview & Subpath Hosted Routes (/sites/:domain/* and /s/:domain/*)
  app.use(['/sites/:domain', '/s/:domain'], (req, res) => {
    const domainParam = req.params.domain || '';
    const site = getSiteByDomain(domainParam) || getSiteById(domainParam);
    if (!site) {
      res.status(404).send(
        `<div dir="rtl" style="font-family:system-ui;max-width:560px;margin:80px auto;padding:32px;border:1px solid #e2e8f0;border-radius:12px">
          <h2 style="margin-top:0">الموقع غير موجود</h2>
          <p style="color:#475569">لم يتم العثور على مشروع مربوط بالدومين <code>${domainParam}</code>.</p>
        </div>`,
      );
      return;
    }

    const baseRoute = req.baseUrl;
    if (req.path === '/' && !req.originalUrl.split('?')[0]?.endsWith('/')) {
      const qs = req.originalUrl.includes('?')
        ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
        : '';
      res.redirect(302, `${baseRoute}/${qs}`);
      return;
    }

    if (site.status === 'building' || site.status === 'uploading') {
      res.status(200).send(
        `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>جاري بناء الموقع...</title></head>
        <body style="font-family:system-ui;max-width:560px;margin:80px auto;padding:32px;background:#f8fafc;color:#0f172a">
          <h2>جاري تجهيز وبناء ${site.customDomain}</h2>
          <p style="color:#475569">${site.statusMessage}</p>
          <p style="color:#64748b;font-size:13px">يتم تحديث الصفحة تلقائياً كل ثانيتين...</p>
        </body></html>`,
      );
      return;
    }

    if (site.status === 'stopped') {
      res.status(503).send(
        `<div dir="rtl" style="font-family:system-ui;max-width:560px;margin:80px auto;padding:32px;border:1px solid #e2e8f0;border-radius:12px">
          <h2 style="margin-top:0">الموقع متوقف مؤقتاً</h2>
          <p style="color:#475569">يمكنك إعادة تشغيل المشروع <strong>${site.customDomain}</strong> من لوحة التحكم.</p>
        </div>`,
      );
      return;
    }

    if (site.status === 'error') {
      res.status(500).send(
        `<div dir="rtl" style="font-family:system-ui;max-width:640px;margin:80px auto;padding:32px;border:1px solid #fecdd3;background:#fff1f2;border-radius:12px;color:#881337">
          <h2 style="margin-top:0">تعذر تشغيل المشروع (${site.customDomain})</h2>
          <p>${site.statusMessage}</p>
          <pre dir="ltr" style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow:auto;font-size:12px">${site.logs.slice(-15).join('\n')}</pre>
        </div>`,
      );
      return;
    }

    const subPath = req.url || '/';
    serveSiteHttp(site, req, res, subPath, baseRoute);
  });

  // 3. JSON body parser for API routes
  app.use('/api', express.json({ limit: '10mb' }));

  app.get('/api/health', async (req, res) => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0];
    const protocol = forwardedProto || req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const publicIp = await getPublicServerIp();
    res.json({
      ok: true,
      capabilities: getRuntimeCapabilities(),
      origin: `${protocol}://${host}`,
      serverIp: publicIp,
      panelHost: getControlPanelHost() || host.split(':')[0],
      serverless: IS_SERVERLESS,
    });
  });

  app.get('/api/caddy-ask', (req, res) => {
    const domain = normalizeDomain(String(req.query.domain || ''));
    if (!domain) {
      res.status(400).send('missing domain');
      return;
    }
    const site = getSiteByDomain(domain);
    if (!site) {
      res.status(404).send('unknown domain');
      return;
    }
    res.status(200).send('ok');
  });

  app.get('/api/templates', (_req, res) => {
    res.json(
      STARTER_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        language: t.language,
        description: t.description,
        defaultDomain: t.defaultDomain,
        fileCount: t.files.length,
      })),
    );
  });

  app.get('/api/sites', (_req, res) => {
    const sites = loadSites().sort(
      (a, b) =>
        new Date(b.lastDeployedAt).getTime() - new Date(a.lastDeployedAt).getTime(),
    );
    res.json(sites);
  });

  app.get('/api/sites/:id', (req, res) => {
    const site = getSiteById(req.params.id);
    if (!site) {
      res.status(404).json({ error: 'المشروع غير موجود' });
      return;
    }
    res.json(site);
  });

  app.post(
    '/api/inspect',
    upload.fields([
      { name: 'zipFile', maxCount: 1 },
      { name: 'files', maxCount: 2500 },
    ]),
    (req, res) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modif-inspect-'));
      try {
        const uploaded = req.files as Record<string, Express.Multer.File[]> | undefined;
        const zipFile = uploaded?.zipFile?.[0];
        const folderFiles = uploaded?.files || [];

        if (zipFile) {
          extractZipToSite(zipFile.buffer, tmpDir);
        } else if (folderFiles.length > 0) {
          let paths: string[] = [];
          try {
            paths = JSON.parse(String(req.body.paths || '[]')) as string[];
          } catch {
            paths = [];
          }
          const items = folderFiles.map((f, idx) => ({
            relPath: paths[idx] || f.originalname,
            buffer: f.buffer,
          }));
          writeUploadedFilesToSite(items, tmpDir);
        } else {
          res.status(400).json({ error: 'يرجى اختيار فولدر أو ملف ZIP للفحص' });
          return;
        }

        const detection = detectProject(tmpDir);
        res.json({
          detection,
          capabilities: getRuntimeCapabilities(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'تعذر فحص الملفات';
        res.status(400).json({ error: message });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  // Chunked Upload Session API
  app.post('/api/uploads/start', (req, res) => {
    try {
      const kind = req.body?.kind === 'zip' ? 'zip' : 'folder';
      const session = createUploadSession(kind);
      res.status(201).json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر بدء جلسة الرفع';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/uploads/:id/chunk', (req, res) => {
    try {
      const uploadId = req.params.id;
      if (typeof req.body?.dataBase64 === 'string') {
        const buf = Buffer.from(req.body.dataBase64, 'base64');
        appendZipChunkToSession(uploadId, buf);
        res.json({ ok: true, receivedBytes: buf.length });
        return;
      }
      if (Array.isArray(req.body?.files)) {
        const items = (
          req.body.files as Array<{ relPath?: string; dataBase64?: string }>
        )
          .filter((f) => f && typeof f.relPath === 'string' && typeof f.dataBase64 === 'string')
          .map((f) => ({
            relPath: String(f.relPath),
            buffer: Buffer.from(String(f.dataBase64), 'base64'),
          }));
        appendFolderBatchToSession(uploadId, items);
        res.json({ ok: true, receivedFiles: items.length });
        return;
      }
      res.status(400).json({ error: 'بيانات الدفعة غير صالحة' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر حفظ دفعة الملفات';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/uploads/:id/inspect', (req, res) => {
    try {
      const result = finalizeAndInspectSession(req.params.id);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر فحص ملفات المشروع';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/uploads/:id/deploy', async (req, res) => {
    try {
      const customDomain = String(req.body?.customDomain || '');
      const name = String(req.body?.name || '');
      const siteId = req.body?.siteId ? String(req.body.siteId) : undefined;
      const site = deployFromUploadSession({
        uploadId: req.params.id,
        name,
        customDomain,
        siteId,
      });
      await waitForBuildInitial(site.id, 3000);
      res.status(201).json(getSiteById(site.id) || site);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر نشر المشروع';
      res.status(400).json({ error: message });
    }
  });

  // Stateless single-request inspect/deploy (ideal for serverless hosts like Vercel)
  app.post('/api/inspect-inline', (req, res) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modif-inline-inspect-'));
    try {
      const kind = req.body?.kind === 'zip' ? 'zip' : 'folder';
      if (kind === 'zip' && typeof req.body?.dataBase64 === 'string') {
        const buf = Buffer.from(req.body.dataBase64, 'base64');
        extractZipToSite(buf, tmpDir);
      } else if (Array.isArray(req.body?.files) && req.body.files.length > 0) {
        const items = (
          req.body.files as Array<{ relPath?: string; dataBase64?: string }>
        )
          .filter((f) => f && typeof f.relPath === 'string' && typeof f.dataBase64 === 'string')
          .map((f) => ({
            relPath: String(f.relPath),
            buffer: Buffer.from(String(f.dataBase64), 'base64'),
          }));
        if (items.length === 0) {
          res.status(400).json({ error: 'لم يتم إرفاق ملفات صالحة للفحص' });
          return;
        }
        writeUploadedFilesToSite(items, tmpDir);
      } else {
        res.status(400).json({ error: 'بيانات المشروع غير مكتملة' });
        return;
      }

      const detection = detectProject(tmpDir);
      res.json({
        detection,
        capabilities: getRuntimeCapabilities(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر فحص الملفات';
      res.status(400).json({ error: message });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  app.post('/api/deploy-inline', async (req, res) => {
    try {
      const customDomain = String(req.body?.customDomain || '');
      const name = String(req.body?.name || '');
      const siteId = req.body?.siteId ? String(req.body.siteId) : undefined;
      const kind = req.body?.kind === 'zip' ? 'zip' : 'folder';

      if (!customDomain.trim()) {
        res.status(400).json({ error: 'يرجى كتابة اسم الدومين المخصص' });
        return;
      }

      if (kind === 'zip' && typeof req.body?.dataBase64 === 'string') {
        const zipBuffer = Buffer.from(req.body.dataBase64, 'base64');
        const site = createOrReplaceSiteFromUpload({
          name,
          customDomain,
          siteId,
          zipBuffer,
        });
        await waitForBuildInitial(site.id, 3000);
        res.status(201).json(getSiteById(site.id) || site);
        return;
      }

      if (Array.isArray(req.body?.files) && req.body.files.length > 0) {
        const items = (
          req.body.files as Array<{ relPath?: string; dataBase64?: string }>
        )
          .filter((f) => f && typeof f.relPath === 'string' && typeof f.dataBase64 === 'string')
          .map((f) => ({
            relPath: String(f.relPath),
            buffer: Buffer.from(String(f.dataBase64), 'base64'),
          }));
        if (items.length === 0) {
          res.status(400).json({ error: 'لم يتم إرفاق ملفات صالحة للنشر' });
          return;
        }
        const site = createOrReplaceSiteFromUpload({
          name,
          customDomain,
          siteId,
          files: items,
        });
        await waitForBuildInitial(site.id, 3000);
        res.status(201).json(getSiteById(site.id) || site);
        return;
      }

      res.status(400).json({ error: 'بيانات المشروع غير مكتملة' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر نشر المشروع';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/inspect-github', async (req, res) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modif-gh-inspect-'));
    try {
      const repoUrl = String(req.body.repoUrl || '');
      const { zipBuffer, repoName, branch, normalizedUrl } =
        await fetchGitHubRepoZipBuffer(repoUrl);
      extractZipToSite(zipBuffer, tmpDir);
      const detection = detectProject(tmpDir);
      res.json({
        repoName,
        branch,
        normalizedUrl,
        detection,
        capabilities: getRuntimeCapabilities(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر جلب مستودع GitHub';
      res.status(400).json({ error: message });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  app.post('/api/deploy-github', async (req, res) => {
    try {
      const repoUrl = String(req.body.repoUrl || '');
      const customDomain = String(req.body.customDomain || '');
      const name = String(req.body.name || '');

      if (!customDomain.trim()) {
        res.status(400).json({ error: 'يرجى كتابة اسم الدومين المخصص' });
        return;
      }

      const { zipBuffer, repoName, normalizedUrl } =
        await fetchGitHubRepoZipBuffer(repoUrl);

      const site = createOrReplaceSiteFromUpload({
        name: name.trim() || repoName,
        customDomain,
        zipBuffer,
        sourceRepoUrl: normalizedUrl,
      });
      await waitForBuildInitial(site.id, 3000);
      res.status(201).json(getSiteById(site.id) || site);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل النشر من GitHub';
      res.status(400).json({ error: message });
    }
  });

  app.post(
    '/api/deploy',
    upload.fields([
      { name: 'zipFile', maxCount: 1 },
      { name: 'files', maxCount: 2500 },
    ]),
    async (req, res) => {
      try {
        const uploaded = req.files as Record<string, Express.Multer.File[]> | undefined;
        const zipFile = uploaded?.zipFile?.[0];
        const folderFiles = uploaded?.files || [];
        const customDomain = String(req.body.customDomain || '');
        const name = String(req.body.name || '');
        const siteId = req.body.siteId ? String(req.body.siteId) : undefined;

        if (!customDomain.trim()) {
          res.status(400).json({ error: 'يرجى كتابة اسم الدومين المخصص' });
          return;
        }

        if (zipFile) {
          const site = createOrReplaceSiteFromUpload({
            name,
            customDomain,
            siteId,
            zipBuffer: zipFile.buffer,
          });
          await waitForBuildInitial(site.id, 3000);
          res.status(201).json(getSiteById(site.id) || site);
          return;
        }

        if (folderFiles.length > 0) {
          let paths: string[] = [];
          try {
            paths = JSON.parse(String(req.body.paths || '[]')) as string[];
          } catch {
            paths = [];
          }
          const items = folderFiles.map((f, idx) => ({
            relPath: paths[idx] || f.originalname,
            buffer: f.buffer,
          }));
          const site = createOrReplaceSiteFromUpload({
            name,
            customDomain,
            siteId,
            files: items,
          });
          await waitForBuildInitial(site.id, 3000);
          res.status(201).json(getSiteById(site.id) || site);
          return;
        }

        res.status(400).json({ error: 'يرجى إرفاق ملف مضغوط ZIP أو فولدر المشروع' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'فشل رفع المشروع';
        res.status(400).json({ error: message });
      }
    },
  );

  app.post('/api/deploy-template', async (req, res) => {
    try {
      const templateId = String(req.body.templateId || '');
      const customDomain = String(req.body.customDomain || '');
      const name = String(req.body.name || '');
      const tpl = STARTER_TEMPLATES.find((t) => t.id === templateId);
      if (!tpl) {
        res.status(404).json({ error: 'القالب المطلوب غير موجود' });
        return;
      }
      const files = tpl.files.map((f) => ({
        relPath: f.relPath,
        buffer: Buffer.from(f.content, 'utf-8'),
      }));
      const site = createOrReplaceSiteFromUpload({
        name: name || tpl.title,
        customDomain: customDomain || tpl.defaultDomain,
        files,
      });
      await waitForBuildInitial(site.id, 3000);
      res.status(201).json(getSiteById(site.id) || site);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر نشر القالب';
      res.status(400).json({ error: message });
    }
  });

  app.patch('/api/sites/:id/domain', (req, res) => {
    try {
      const updated = updateSiteDomain(
        req.params.id,
        String(req.body.customDomain || ''),
        req.body.name ? String(req.body.name) : undefined,
      );
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تحديث الدومين';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/sites/:id/rebuild', async (req, res) => {
    const site = getSiteById(req.params.id);
    if (!site) {
      res.status(404).json({ error: 'المشروع غير موجود' });
      return;
    }
    stopSiteProcess(site.id);
    void triggerSiteBuild(site.id);
    await waitForBuildInitial(site.id, 3000);
    res.json({ ok: true });
  });

  app.post('/api/sites/:id/stop', (req, res) => {
    const site = getSiteById(req.params.id);
    if (!site) {
      res.status(404).json({ error: 'المشروع غير موجود' });
      return;
    }
    stopSiteProcess(site.id);
    res.json(getSiteById(site.id));
  });

  app.delete('/api/sites/:id', (req, res) => {
    const ok = deleteSite(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'المشروع غير موجود' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/sites/:id/files', (req, res) => {
    const site = getSiteById(req.params.id);
    if (!site) {
      res.status(404).json({ error: 'المشروع غير موجود' });
      return;
    }
    res.json(listSiteFiles(site.id));
  });

  app.get('/api/sites/:id/file', (req, res) => {
    try {
      const relPath = String(req.query.path || '');
      const content = readSiteFileContent(req.params.id, relPath);
      res.json({ path: relPath, content });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر قراءة الملف';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/sites/:id/download', (req, res) => {
    try {
      const site = getSiteById(req.params.id);
      if (!site) {
        res.status(404).json({ error: 'المشروع غير موجود' });
        return;
      }
      const buffer = createSiteZipBuffer(site.id);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${site.customDomain}.zip"`,
      );
      res.send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تصدير الأرشيف';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/verify-domain', async (req, res) => {
    const domain = normalizeDomain(String(req.body.domain || ''));
    if (!domain) {
      res.status(400).json({ error: 'أدخل اسم دومين صحيح للتحقق' });
      return;
    }

    const site = getSiteByDomain(domain);
    let dnsA: string[] = [];
    let dnsCname: string[] = [];
    let dnsError: string | null = null;

    try {
      dnsA = await dns.resolve4(domain);
    } catch {
      // ignore
    }
    try {
      dnsCname = await dns.resolveCname(domain);
    } catch {
      // ignore
    }
    const tld = domain.split('.').pop() || '';
    const hasInvalidTld = !domain.includes('.') || !/^[a-z]{2,24}$/i.test(tld);

    if (dnsA.length === 0 && dnsCname.length === 0) {
      dnsError = hasInvalidTld
        ? `النطاق "${domain}" لا يحتوي على امتداد إنترنت حقيقي صالح (مثل .com أو .icu)؛ لذلك يرفض المتصفح فتحه ويعرض DNS_PROBE_FINISHED_NXDOMAIN.`
        : 'لم يتم العثور على سجلات DNS عامة لهذا النطاق على الإنترنت بعد';
    }

    const localRouteStatus = IS_SERVERLESS
      ? { status: site ? 200 : 404, ok: Boolean(site) }
      : await new Promise<{ status: number; ok: boolean }>((resolve) => {
          const probeReq = http.request(
            {
              hostname: '127.0.0.1',
              port: PORT,
              path: '/',
              method: 'GET',
              headers: { Host: domain },
              timeout: 3000,
            },
            (probeRes) => {
              probeRes.resume();
              resolve({
                status: probeRes.statusCode || 500,
                ok: (probeRes.statusCode || 500) < 400,
              });
            },
          );
          probeReq.on('error', () => resolve({ status: 500, ok: false }));
          probeReq.end();
        });

    res.json({
      domain,
      registered: Boolean(site),
      siteId: site?.id || null,
      hostRoutingReady: Boolean(site) && localRouteStatus.ok,
      hostRoutingStatus: localRouteStatus.status,
      dnsA,
      dnsCname,
      dnsError,
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'نقطة نهاية API غير موجودة' });
  });

  app.use(
    '/api',
    (
      err: Error & { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err.status && err.status >= 400 ? err.status : 400;
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'حجم الملف يتجاوز الحد المسموح به'
          : err.message || 'حدث خطأ في الخادم أثناء معالجة الطلب';
      res.status(status).json({ error: msg });
    },
  );

  // 4. Referer-aware fallback for root-relative assets loaded from /sites/:domain/
  app.use((req, res, next) => {
    if (serveRefererAssetIfMatched(req, res)) {
      return;
    }
    next();
  });

  // 5. Vite dev middleware or production static dist
  if (options.attachVite) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (options.serveDist) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}
