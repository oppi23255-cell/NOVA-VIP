import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  detectProject,
  getRuntimeCapabilities,
  unwrapSingleRootFolder,
} from './detector.ts';
import type { SiteFileEntry, SiteRecord } from './types.ts';

const DATA_ROOT = path.resolve(process.cwd(), 'hosted_data');
const SITES_DIR = path.join(DATA_ROOT, 'sites');
const REGISTRY_FILE = path.join(DATA_ROOT, 'sites.json');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

const runningProcesses = new Map<string, ChildProcess>();

function ensureStorage(): void {
  fs.mkdirSync(SITES_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, '[]', 'utf-8');
  }
}

export function normalizeDomain(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    ?.split(':')[0]
    ?.replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
  return cleaned || '';
}

export function loadSites(): SiteRecord[] {
  ensureStorage();
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SiteRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveSites(sites: SiteRecord[]): void {
  ensureStorage();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(sites, null, 2), 'utf-8');
}

export function getSiteById(id: string): SiteRecord | undefined {
  return loadSites().find((s) => s.id === id);
}

export function getSiteByDomain(domainOrHost: string): SiteRecord | undefined {
  const host = normalizeDomain(domainOrHost);
  if (!host) return undefined;
  return loadSites().find(
    (s) =>
      s.customDomain.toLowerCase() === host ||
      s.aliases.some((a) => a.toLowerCase() === host),
  );
}

function updateSiteRecord(
  id: string,
  updater: (site: SiteRecord) => SiteRecord,
): SiteRecord | undefined {
  const sites = loadSites();
  const idx = sites.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  const updated = updater(sites[idx]);
  sites[idx] = updated;
  saveSites(sites);
  return updated;
}

function appendLog(id: string, line: string): void {
  const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const cleanLines = line
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (cleanLines.length === 0) return;

  updateSiteRecord(id, (site) => {
    const nextLogs = [
      ...site.logs,
      ...cleanLines.map((l) => `[${timestamp}] ${l}`),
    ].slice(-250);
    return {
      ...site,
      logs: nextLogs,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function getSiteDir(id: string): string {
  return path.join(SITES_DIR, id);
}

function sanitizeRelPath(relPath: string): string | null {
  const normalized = relPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
  if (!normalized) return null;
  return normalized;
}

export function extractZipToSite(zipBuffer: Buffer, siteDir: string): void {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (
      entryName.startsWith('__MACOSX/') ||
      entryName.includes('/__MACOSX/') ||
      entryName.endsWith('.DS_Store')
    ) {
      continue;
    }
    const safeRel = sanitizeRelPath(entryName);
    if (!safeRel) continue;
    const targetPath = path.join(siteDir, safeRel);
    if (!targetPath.startsWith(siteDir)) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, entry.getData());
  }

  unwrapSingleRootFolder(siteDir);
}

export function writeUploadedFilesToSite(
  files: Array<{ relPath: string; buffer: Buffer }>,
  siteDir: string,
): void {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });

  for (const file of files) {
    const safeRel = sanitizeRelPath(file.relPath);
    if (!safeRel) continue;
    if (
      safeRel.startsWith('__MACOSX/') ||
      safeRel.endsWith('.DS_Store') ||
      safeRel.startsWith('node_modules/') ||
      safeRel.startsWith('.git/')
    ) {
      continue;
    }
    const targetPath = path.join(siteDir, safeRel);
    if (!targetPath.startsWith(siteDir)) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.buffer);
  }

  unwrapSingleRootFolder(siteDir);
}

export async function fetchGitHubRepoZipBuffer(rawUrl: string): Promise<{
  zipBuffer: Buffer;
  repoName: string;
  branch: string;
  normalizedUrl: string;
}> {
  const cleaned = rawUrl.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = cleaned.match(
    /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/([^/]+))?/i,
  );
  if (!match) {
    throw new Error('صيغة رابط GitHub غير صحيحة (مثال: https://github.com/user/repo)');
  }
  const owner = match[1];
  const repo = match[2];
  let branch = match[3] || '';

  if (!branch) {
    try {
      const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { 'User-Agent': 'Modif-Hosting-Engine' },
      });
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as { default_branch?: string };
        if (meta.default_branch) branch = meta.default_branch;
      }
    } catch {
      // ignore metadata lookup errors and fall back to main/master
    }
  }

  const candidateBranches = branch ? [branch] : ['main', 'master'];
  for (const br of candidateBranches) {
    const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(br)}`;
    const resp = await fetch(zipUrl, {
      headers: { 'User-Agent': 'Modif-Hosting-Engine' },
    });
    if (resp.ok) {
      const arrBuf = await resp.arrayBuffer();
      return {
        zipBuffer: Buffer.from(arrBuf),
        repoName: repo,
        branch: br,
        normalizedUrl: `https://github.com/${owner}/${repo}`,
      };
    }
  }

  throw new Error(
    `تعذر تحميل المستودع ${owner}/${repo} من GitHub (تأكد أن المستودع عام Public وأن الاسم صحيح)`,
  );
}

export function createOrReplaceSiteFromUpload(params: {
  name: string;
  customDomain: string;
  siteId?: string;
  zipBuffer?: Buffer;
  files?: Array<{ relPath: string; buffer: Buffer }>;
  sourceRepoUrl?: string;
}): SiteRecord {
  ensureStorage();
  const domain = normalizeDomain(params.customDomain);
  if (!domain) {
    throw new Error('يرجى إدخال اسم دومين صالح بحروف إنجليزية أو أرقام (مثال: my-app.dev)');
  }

  const allSites = loadSites();
  const existingByDomain = allSites.find(
    (s) =>
      s.id !== params.siteId &&
      (s.customDomain === domain || s.aliases.includes(domain)),
  );
  if (existingByDomain) {
    throw new Error(`الدومين "${domain}" مستخدم بالفعل لمشروع آخر`);
  }

  const id = params.siteId || crypto.randomBytes(5).toString('hex');
  stopSiteProcess(id);

  const siteDir = getSiteDir(id);
  if (params.zipBuffer) {
    extractZipToSite(params.zipBuffer, siteDir);
  } else if (params.files && params.files.length > 0) {
    writeUploadedFilesToSite(params.files, siteDir);
  } else {
    throw new Error('لم يتم استلام أي ملفات أو أرشيف ZIP');
  }

  const detection = detectProject(siteDir);
  const now = new Date().toISOString();
  const existing = allSites.find((s) => s.id === id);

  const record: SiteRecord = {
    id,
    name: params.name.trim() || domain,
    customDomain: domain,
    aliases: existing?.aliases || [],
    status: 'building',
    statusMessage: 'جاري فحص المشروع وتجهيز بيئة التشغيل...',
    detection,
    port: null,
    pid: null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastDeployedAt: now,
    sourceRepoUrl: params.sourceRepoUrl || existing?.sourceRepoUrl,
    logs: [
      `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] تم استلام ${detection.fileCount} ملف (${formatBytes(detection.totalBytes)})`,
      `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] اكتشاف تلقائي: ${detection.language} — ${detection.framework}`,
    ],
  };

  if (existing) {
    const idx = allSites.findIndex((s) => s.id === id);
    allSites[idx] = record;
  } else {
    allSites.unshift(record);
  }
  saveSites(allSites);

  void buildAndLaunchSite(id);

  return record;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Failed to allocate port')));
      }
    });
  });
}

function runShellCommand(
  siteId: string,
  command: string,
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    appendLog(siteId, `$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => appendLog(siteId, chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => appendLog(siteId, chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function waitForPort(port: number, timeoutMs = 12000): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          resolve(false);
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

export function stopSiteProcess(siteId: string): void {
  const proc = runningProcesses.get(siteId);
  if (proc) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    runningProcesses.delete(siteId);
  }
  updateSiteRecord(siteId, (site) => ({
    ...site,
    port: null,
    pid: null,
    status: site.status === 'live' ? 'stopped' : site.status,
    statusMessage:
      site.status === 'live' ? 'تم إيقاف التشغيل' : site.statusMessage,
  }));
}

async function bundleReactWithLocalEsbuild(
  siteId: string,
  siteDir: string,
  entryFile: string,
): Promise<void> {
  const distDir = path.join(siteDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const esbuildBin = path.resolve(process.cwd(), 'node_modules/.bin/esbuild');
  const workspaceNodeModules = path.resolve(process.cwd(), 'node_modules');
  const outBundle = path.join(distDir, 'app.js');

  const fullEntryPath = path.join(siteDir, entryFile);
  const entrySource = fs.existsSync(fullEntryPath)
    ? fs.readFileSync(fullEntryPath, 'utf-8')
    : '';

  let buildTarget = entryFile;
  let tempBootstrapPath: string | null = null;

  // If entry file only exports a component without mounting via createRoot/render, create a tiny bootstrapper
  const mountsToDom =
    entrySource.includes('createRoot') ||
    entrySource.includes('ReactDOM.render') ||
    entrySource.includes('hydrateRoot');

  if (!mountsToDom && /export\s+default\b/.test(entrySource)) {
    tempBootstrapPath = path.join(siteDir, '_modif_entry.tsx');
    const relImport = `./${entryFile.replace(/\\/g, '/')}`;
    fs.writeFileSync(
      tempBootstrapPath,
      `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '${relImport}';
let container = document.getElementById('root') || document.getElementById('app');
if (!container) {
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
}
createRoot(container).render(React.createElement(App));
`,
      'utf-8',
    );
    buildTarget = '_modif_entry.tsx';
  }

  try {
    const code = await runShellCommand(
      siteId,
      esbuildBin,
      [
        buildTarget,
        '--bundle',
        '--format=esm',
        '--jsx=automatic',
        '--loader:.css=css',
        '--loader:.svg=dataurl',
        '--loader:.png=dataurl',
        `--outfile=${outBundle}`,
      ],
      siteDir,
      { NODE_PATH: workspaceNodeModules },
    );

    if (code !== 0) {
      throw new Error('فشل تجميع ملفات React عبر ESBuild');
    }
  } finally {
    if (tempBootstrapPath && fs.existsSync(tempBootstrapPath)) {
      fs.rmSync(tempBootstrapPath, { force: true });
    }
  }

  const hasBundledCss = fs.existsSync(path.join(distDir, 'app.css'));
  const candidateHtmlPaths = [
    path.join(siteDir, 'index.html'),
    path.join(siteDir, 'public/index.html'),
  ];
  const existingHtmlPath = candidateHtmlPaths.find((p) => fs.existsSync(p));

  let html = '';
  if (existingHtmlPath) {
    html = fs.readFileSync(existingHtmlPath, 'utf-8');
    // Replace any local script tag pointing to JSX/TSX/TS source
    html = html.replace(
      /<script[^>]+src=["'][^"']*\.(tsx|jsx|ts)["'][^>]*><\/script>/gi,
      '<script type="module" src="./app.js"></script>',
    );
    if (!html.includes('./app.js')) {
      html = html.includes('</body>')
        ? html.replace('</body>', '<script type="module" src="./app.js"></script></body>')
        : `${html}\n<script type="module" src="./app.js"></script>`;
    }
    if (hasBundledCss && !html.includes('./app.css')) {
      html = html.includes('</head>')
        ? html.replace('</head>', '<link rel="stylesheet" href="./app.css" /></head>')
        : `<link rel="stylesheet" href="./app.css" />${html}`;
    }
  } else {
    html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>React App</title>
  ${hasBundledCss ? '<link rel="stylesheet" href="./app.css" />' : ''}
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./app.js"></script>
</body>
</html>`;
  }
  fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf-8');
}

export async function buildAndLaunchSite(siteId: string): Promise<void> {
  const site = getSiteById(siteId);
  if (!site) return;

  const siteDir = getSiteDir(siteId);
  const detection = detectProject(siteDir);
  const caps = getRuntimeCapabilities();

  updateSiteRecord(siteId, (s) => ({
    ...s,
    detection,
    status: 'building',
    statusMessage: 'جاري تجهيز المشروع وتشغيله...',
  }));

  try {
    if (detection.mode === 'static' || detection.mode === 'files_only') {
      appendLog(siteId, 'الموقع جاهز للتشغيل المباشر (Static Serving).');
      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: 'live',
        statusMessage: 'يعمل الآن ومربوط بالدومين المخصص',
        port: null,
        pid: null,
      }));
      return;
    }

    if (detection.mode === 'esbuild_react_static' && detection.entryFile) {
      await bundleReactWithLocalEsbuild(siteId, siteDir, detection.entryFile);
      appendLog(siteId, 'تم تجميع تطبيق React بنجاح وجاهز للعرض.');
      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: 'live',
        statusMessage: 'تم البناء ويعمل الآن',
        detection: { ...detection, outputDir: 'dist', entryFile: 'dist/index.html' },
      }));
      return;
    }

    if (detection.mode === 'node_build_static') {
      if (!fs.existsSync(path.join(siteDir, 'node_modules'))) {
        appendLog(siteId, 'تثبيت الحزم المطلوبة (npm install)...');
        const installCode = await runShellCommand(
          siteId,
          'npm',
          ['install', '--include=dev', '--no-audit', '--no-fund'],
          siteDir,
          { NODE_ENV: 'development' },
        );
        if (installCode !== 0) {
          appendLog(siteId, 'تنبيه: تعذر إكمال npm install، سيتم محاولة التجميع المباشر...');
        }
      }

      const pkg = JSON.parse(
        fs.readFileSync(path.join(siteDir, 'package.json'), 'utf-8'),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const hasVite = Boolean(pkg.dependencies?.vite || pkg.devDependencies?.vite);

      let buildCode = 1;
      if (hasVite && (!pkg.scripts?.build || pkg.scripts.build.includes('vite build'))) {
        buildCode = await runShellCommand(
          siteId,
          'npx',
          ['vite', 'build', '--base=./'],
          siteDir,
        );
      } else {
        buildCode = await runShellCommand(siteId, 'npm', ['run', 'build'], siteDir);
        if (buildCode !== 0 && hasVite) {
          appendLog(siteId, 'إعادة المحاولة عبر vite build مباشرة...');
          buildCode = await runShellCommand(
            siteId,
            'npx',
            ['vite', 'build', '--base=./'],
            siteDir,
          );
        }
      }

      if (buildCode !== 0) {
        const fallbackEntry = [
          'src/main.tsx',
          'src/main.jsx',
          'src/index.tsx',
          'src/index.jsx',
          'src/App.tsx',
          'src/App.jsx',
        ].find((c) => fs.existsSync(path.join(siteDir, c)));

        if (fallbackEntry) {
          appendLog(siteId, `تفعيل التجميع الاحتياطي عبر ESBuild لملف ${fallbackEntry}...`);
          await bundleReactWithLocalEsbuild(siteId, siteDir, fallbackEntry);
        } else {
          throw new Error('فشل بناء المشروع (npm run build)');
        }
      }

      const outDir = fs.existsSync(path.join(siteDir, 'dist/index.html'))
        ? 'dist'
        : fs.existsSync(path.join(siteDir, 'build/index.html'))
          ? 'build'
          : fs.existsSync(path.join(siteDir, 'out/index.html'))
            ? 'out'
            : detection.outputDir || 'dist';

      appendLog(siteId, `تم البناء بنجاح داخل ${outDir}/ والموقع يعمل الآن.`);
      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: 'live',
        statusMessage: 'تم البناء ويعمل الآن',
        detection: { ...detection, outputDir: outDir, entryFile: `${outDir}/index.html` },
      }));
      return;
    }

    if (detection.mode === 'node_server') {
      const hasPkg = fs.existsSync(path.join(siteDir, 'package.json'));
      if (hasPkg && !fs.existsSync(path.join(siteDir, 'node_modules'))) {
        appendLog(siteId, 'تثبيت حزم Node.js (npm install)...');
        const installCode = await runShellCommand(
          siteId,
          'npm',
          ['install', '--include=dev', '--no-audit', '--no-fund'],
          siteDir,
          { NODE_ENV: 'development' },
        );
        if (installCode !== 0) {
          throw new Error('فشل تثبيت حزم Node.js');
        }
      }

      if (detection.buildCommand) {
        const bCode = await runShellCommand(siteId, 'npm', ['run', 'build'], siteDir);
        if (bCode !== 0) {
          throw new Error('فشل بناء تطبيق Node.js');
        }
      }

      const port = await findFreePort();
      const startParts = (detection.startCommand || `node ${detection.entryFile}`).split(/\s+/);
      const cmd = startParts[0] || 'node';
      const args = startParts.slice(1);

      appendLog(siteId, `تشغيل الخادم على المنفذ الداخلي ${port}...`);
      const child = spawn(cmd, args, {
        cwd: siteDir,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runningProcesses.set(siteId, child);
      child.stdout.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
      child.stderr.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
      child.on('exit', (code) => {
        runningProcesses.delete(siteId);
        appendLog(siteId, `توقف الخادم برمز خروج: ${code ?? 'null'}`);
        updateSiteRecord(siteId, (s) =>
          s.status === 'live'
            ? { ...s, status: 'stopped', port: null, pid: null, statusMessage: 'توقفت عملية التشغيل' }
            : s,
        );
      });

      const ready = await waitForPort(port, 12000);
      if (!ready) {
        appendLog(siteId, 'تنبيه: العملية بدأت لكن المنفذ لم يستجب خلال 12 ثانية.');
      }

      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: ready ? 'live' : 'error',
        statusMessage: ready
          ? `يعمل خادم Node.js على المنفذ ${port}`
          : 'بدأ التشغيل لكن الخادم لم يفتح المنفذ المطلوب (تأكد من قراءة متغير PORT)',
        port: ready ? port : null,
        pid: child.pid || null,
      }));
      return;
    }

    if (detection.mode === 'python_server') {
      if (!caps.python3) {
        updateSiteRecord(siteId, (s) => ({
          ...s,
          status: 'runtime_missing',
          statusMessage: 'بيئة Python 3 غير متوفرة على هذا الخادم لتشغيل الملفات البرمجية',
        }));
        return;
      }

      const port = await findFreePort();
      const entry = detection.entryFile;
      let spawnArgs = entry ? [entry] : ['-m', 'http.server', String(port)];
      let fallbackToHttpServer = false;

      if (entry) {
        const content = fs.readFileSync(path.join(siteDir, entry), 'utf-8');
        if (!content.includes('PORT') && !content.includes('listen') && !content.includes('app.run') && !content.includes('HTTPServer')) {
          fallbackToHttpServer = true;
        }
      }

      if (fallbackToHttpServer) {
        spawnArgs = ['-m', 'http.server', String(port), '--bind', '127.0.0.1'];
      }

      appendLog(siteId, `تشغيل Python 3 على المنفذ ${port}...`);
      const child = spawn('python3', spawnArgs, {
        cwd: siteDir,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runningProcesses.set(siteId, child);
      child.stdout.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
      child.stderr.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
      child.on('exit', (code) => {
        runningProcesses.delete(siteId);
        appendLog(siteId, `توقفت عملية Python برمز: ${code ?? 'null'}`);
        updateSiteRecord(siteId, (s) =>
          s.status === 'live'
            ? { ...s, status: 'stopped', port: null, pid: null, statusMessage: 'توقفت عملية Python' }
            : s,
        );
      });

      const ready = await waitForPort(port, 8000);
      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: ready ? 'live' : 'error',
        statusMessage: ready
          ? `يعمل خادم Python على المنفذ ${port}`
          : 'تعذر فتح منفذ Python — تأكد من تثبيت المكتبات في requirements.txt أو استخدام متغير PORT',
        port: ready ? port : null,
        pid: child.pid || null,
      }));
      return;
    }

    if (detection.mode === 'java_server') {
      if (!caps.java) {
        if (detection.outputDir && fs.existsSync(path.join(siteDir, detection.outputDir, 'index.html'))) {
          appendLog(
            siteId,
            'تنبيه: بيئة Java (JDK) غير مثبتة على الخادم الحالي، لكن تم العثور على واجهة ويب ثابتة وسيتم تشغيلها فوراً.',
          );
          updateSiteRecord(siteId, (s) => ({
            ...s,
            status: 'live',
            statusMessage: 'تم اكتشاف Java · يتم عرض الواجهة الثابتة المتاحة',
            port: null,
          }));
          return;
        }
        appendLog(
          siteId,
          'تم اكتشاف مشروع Java بنجاح، لكن بيئة JDK/Java غير مثبتة في حاوية السيرفر الحالية.',
        );
        updateSiteRecord(siteId, (s) => ({
          ...s,
          status: 'runtime_missing',
          statusMessage: 'تم اكتشاف Java · يلزم توفر JDK على السيرفر للتشغيل التنفيذي',
        }));
        return;
      }

      const port = await findFreePort();
      const jarFile = detection.entryFile?.endsWith('.jar') ? detection.entryFile : null;
      if (jarFile) {
        const child = spawn('java', [`-Dserver.port=${port}`, '-jar', jarFile], {
          cwd: siteDir,
          env: { ...process.env, PORT: String(port) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        runningProcesses.set(siteId, child);
        child.stdout.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
        child.stderr.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
        const ready = await waitForPort(port, 15000);
        updateSiteRecord(siteId, (s) => ({
          ...s,
          status: ready ? 'live' : 'error',
          statusMessage: ready ? `يعمل تطبيق Java على المنفذ ${port}` : 'فشل تشغيل ملف JAR',
          port: ready ? port : null,
          pid: child.pid || null,
        }));
        return;
      }

      if (fs.existsSync(path.join(siteDir, 'pom.xml')) && caps.mvn) {
        const child = spawn('mvn', ['spring-boot:run', `-Dspring-boot.run.arguments=--server.port=${port}`], {
          cwd: siteDir,
          env: { ...process.env, PORT: String(port) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        runningProcesses.set(siteId, child);
        child.stdout.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
        child.stderr.on('data', (d: Buffer) => appendLog(siteId, d.toString()));
        const ready = await waitForPort(port, 20000);
        updateSiteRecord(siteId, (s) => ({
          ...s,
          status: ready ? 'live' : 'error',
          statusMessage: ready ? `يعمل مشروع Maven/Spring Boot على المنفذ ${port}` : 'انتهى وقت تشغيل Maven',
          port: ready ? port : null,
          pid: child.pid || null,
        }));
        return;
      }

      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: 'runtime_missing',
        statusMessage: 'يلزم وجود ملف JAR تنفيذي أو أداة Maven للتشغيل التلقائي',
      }));
      return;
    }

    if (detection.mode === 'php_server') {
      if (!caps.php) {
        appendLog(siteId, 'تم اكتشاف مشروع PHP، لكن مفسر PHP غير مثبت على هذا الخادم.');
        updateSiteRecord(siteId, (s) => ({
          ...s,
          status: 'runtime_missing',
          statusMessage: 'تم اكتشاف PHP · يلزم تثبيت PHP CLI على السيرفر للتشغيل',
        }));
        return;
      }
      const port = await findFreePort();
      const docRoot = detection.outputDir || '.';
      const child = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docRoot], {
        cwd: siteDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runningProcesses.set(siteId, child);
      const ready = await waitForPort(port, 8000);
      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: ready ? 'live' : 'error',
        statusMessage: ready ? `يعمل خادم PHP على المنفذ ${port}` : 'فشل تشغيل خادم PHP',
        port: ready ? port : null,
        pid: child.pid || null,
      }));
      return;
    }

    if (detection.mode === 'go_server') {
      if (!caps.go) {
        appendLog(siteId, 'تم اكتشاف مشروع Go، لكن مترجم Go غير مثبت على هذا الخادم.');
        updateSiteRecord(siteId, (s) => ({
          ...s,
          status: 'runtime_missing',
          statusMessage: 'تم اكتشاف Go · يلزم تثبيت Go على السيرفر للتشغيل',
        }));
        return;
      }
      const port = await findFreePort();
      const bCode = await runShellCommand(siteId, 'go', ['build', '-o', 'server_bin', '.'], siteDir);
      if (bCode !== 0) throw new Error('فشل بناء مشروع Go');
      const child = spawn('./server_bin', [], {
        cwd: siteDir,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runningProcesses.set(siteId, child);
      const ready = await waitForPort(port, 8000);
      updateSiteRecord(siteId, (s) => ({
        ...s,
        status: ready ? 'live' : 'error',
        statusMessage: ready ? `يعمل خادم Go على المنفذ ${port}` : 'فشل تشغيل خادم Go',
        port: ready ? port : null,
        pid: child.pid || null,
      }));
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء النشر';
    appendLog(siteId, `خطأ: ${message}`);
    updateSiteRecord(siteId, (s) => ({
      ...s,
      status: 'error',
      statusMessage: message,
    }));
  }
}

export function deleteSite(siteId: string): boolean {
  stopSiteProcess(siteId);
  const sites = loadSites();
  const next = sites.filter((s) => s.id !== siteId);
  if (next.length === sites.length) return false;
  saveSites(next);
  fs.rmSync(getSiteDir(siteId), { recursive: true, force: true });
  return true;
}

export function updateSiteDomain(
  siteId: string,
  newDomainRaw: string,
  newName?: string,
): SiteRecord {
  const newDomain = normalizeDomain(newDomainRaw);
  if (!newDomain) {
    throw new Error('يرجى إدخال دومين مخصص صحيح');
  }
  const sites = loadSites();
  const duplicate = sites.find(
    (s) => s.id !== siteId && (s.customDomain === newDomain || s.aliases.includes(newDomain)),
  );
  if (duplicate) {
    throw new Error(`الدومين "${newDomain}" مستخدم بالفعل لمشروع "${duplicate.name}"`);
  }
  const updated = updateSiteRecord(siteId, (s) => ({
    ...s,
    customDomain: newDomain,
    name: newName?.trim() ? newName.trim() : s.name,
    updatedAt: new Date().toISOString(),
  }));
  if (!updated) throw new Error('المشروع غير موجود');
  return updated;
}

export function listSiteFiles(siteId: string): SiteFileEntry[] {
  const siteDir = getSiteDir(siteId);
  if (!fs.existsSync(siteDir)) return [];
  const results: SiteFileEntry[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(siteDir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        results.push({ path: rel, size: 0, isDirectory: true });
        walk(full);
      } else if (entry.isFile()) {
        results.push({
          path: rel,
          size: fs.statSync(full).size,
          isDirectory: false,
        });
      }
    }
  }

  walk(siteDir);
  return results;
}

export function readSiteFileContent(siteId: string, relPath: string): string {
  const siteDir = getSiteDir(siteId);
  const safeRel = sanitizeRelPath(relPath);
  if (!safeRel) throw new Error('مسار ملف غير صالح');
  const full = path.resolve(siteDir, safeRel);
  if (!full.startsWith(siteDir) || !fs.existsSync(full)) {
    throw new Error('الملف غير موجود');
  }
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error('المسار ليس ملفاً');
  if (stat.size > 512 * 1024) {
    return fs.readFileSync(full, 'utf-8').slice(0, 60000) + '\n\n... (تم اقتصاص العرض لحجم الملف الكبير)';
  }
  return fs.readFileSync(full, 'utf-8');
}

export function createSiteZipBuffer(siteId: string): Buffer {
  const siteDir = getSiteDir(siteId);
  if (!fs.existsSync(siteDir)) {
    throw new Error('مجلد المشروع غير موجود');
  }
  const zip = new AdmZip();

  function addDir(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(siteDir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        addDir(full);
      } else if (entry.isFile()) {
        const relDir = path.dirname(rel);
        zip.addLocalFile(full, relDir === '.' ? '' : relDir);
      }
    }
  }

  addDir(siteDir);
  return zip.toBuffer();
}

function rewriteHtmlForSubpath(html: string, mountPrefix: string): string {
  if (!mountPrefix || mountPrefix === '/') return html;
  const prefix = mountPrefix.replace(/\/+$/, '');

  let out = html.replace(
    /\b(src|href|action)=("|')\/(?!\/|sites\/|s\/)([^"']*)\2/gi,
    (_m, attr: string, quote: string, rest: string) =>
      `${attr}=${quote}${prefix}/${rest}${quote}`,
  );

  if (!/<base\s/i.test(out)) {
    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head([^>]*)>/i, `<head$1>\n    <base href="${prefix}/" />`);
    }
  }
  return out;
}

function resolveSiteStaticFile(site: SiteRecord, subPath: string): string | null {
  const siteDir = getSiteDir(site.id);
  const outRel =
    site.detection.outputDir && site.detection.outputDir !== '.'
      ? site.detection.outputDir
      : '';
  const rootDir = outRel ? path.join(siteDir, outRel) : siteDir;
  const effectiveRoot = fs.existsSync(rootDir) ? rootDir : siteDir;

  const cleanSubPath = decodeURIComponent(
    (subPath.split('?')[0] || '/').replace(/^\/+/, ''),
  );
  let candidate = path.resolve(effectiveRoot, cleanSubPath || '');
  if (!candidate.startsWith(effectiveRoot)) return null;

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    const idx = path.join(candidate, 'index.html');
    const entryName = site.detection.entryFile
      ? path.basename(site.detection.entryFile)
      : 'index.html';
    const altEntry = path.join(candidate, entryName);
    if (fs.existsSync(idx)) {
      return idx;
    }
    if (entryName.endsWith('.html') && fs.existsSync(altEntry)) {
      return altEntry;
    }
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  // Try siteDir directly if outRel didn't contain an uploaded asset
  if (outRel && cleanSubPath) {
    const directCandidate = path.resolve(siteDir, cleanSubPath);
    if (
      directCandidate.startsWith(siteDir) &&
      fs.existsSync(directCandidate) &&
      fs.statSync(directCandidate).isFile()
    ) {
      return directCandidate;
    }
  }

  return null;
}

export function serveRefererAssetIfMatched(
  req: http.IncomingMessage & { path?: string; url: string; headers: http.IncomingHttpHeaders },
  res: http.ServerResponse,
): boolean {
  const referer = String(req.headers.referer || '');
  const match = referer.match(/\/(?:sites|s)\/([^/?#]+)/i);
  if (!match) return false;
  const domainOrId = decodeURIComponent(match[1] || '');
  const site = getSiteByDomain(domainOrId) || getSiteById(domainOrId);
  if (!site) return false;

  const reqPath = (req.url || '').split('?')[0] || '';
  if (!reqPath || reqPath === '/' || !path.extname(reqPath)) return false;

  const file = resolveSiteStaticFile(site, reqPath);
  if (!file) return false;

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

export function serveSiteHttp(
  site: SiteRecord,
  req: http.IncomingMessage & {
    originalUrl?: string;
    url: string;
    method?: string;
    headers: http.IncomingHttpHeaders;
  },
  res: http.ServerResponse,
  subPath: string,
  mountPrefix: string,
): void {
  if (site.port && site.status === 'live') {
    const targetPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
    const proxyHeaders: http.OutgoingHttpHeaders = { ...req.headers };
    proxyHeaders.host = `127.0.0.1:${site.port}`;
    proxyHeaders['x-forwarded-host'] = String(
      req.headers.host || site.customDomain,
    );

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: site.port,
        path: targetPath,
        method: req.method || 'GET',
        headers: proxyHeaders,
      },
      (proxyRes) => {
        const headers = { ...proxyRes.headers };
        if (
          mountPrefix &&
          mountPrefix !== '/' &&
          typeof headers.location === 'string' &&
          headers.location.startsWith('/') &&
          !headers.location.startsWith(mountPrefix)
        ) {
          headers.location = `${mountPrefix}${headers.location}`;
        }
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2 dir="rtl">تعذر الاتصال بخادم التطبيق الداخلي</h2>');
      }
    });

    req.pipe(proxyReq);
    return;
  }

  const siteDir = getSiteDir(site.id);
  const outRel =
    site.detection.outputDir && site.detection.outputDir !== '.'
      ? site.detection.outputDir
      : '';
  const rootDir = outRel ? path.join(siteDir, outRel) : siteDir;
  const effectiveRoot = fs.existsSync(rootDir) ? rootDir : siteDir;

  let candidate = resolveSiteStaticFile(site, subPath);
  const cleanSubPath = decodeURIComponent(
    (subPath.split('?')[0] || '/').replace(/^\/+/, ''),
  );

  // SPA fallback when no file extension matches
  if (!candidate && !path.extname(cleanSubPath)) {
    const entryName = site.detection.entryFile
      ? path.basename(site.detection.entryFile)
      : 'index.html';
    const rootIndex = path.join(effectiveRoot, 'index.html');
    const fallbackHtml = path.join(effectiveRoot, entryName);
    if (fs.existsSync(rootIndex)) {
      candidate = rootIndex;
    } else if (entryName.endsWith('.html') && fs.existsSync(fallbackHtml)) {
      candidate = fallbackHtml;
    }
  }

  if (!candidate) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<div dir="rtl" style="font-family:system-ui;padding:40px;text-align:center"><h2>404 — الملف غير موجود</h2><p>${cleanSubPath}</p></div>`,
    );
    return;
  }

  const ext = path.extname(candidate).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (ext === '.html' || ext === '.htm') {
    const html = fs.readFileSync(candidate, 'utf-8');
    const rewritten = rewriteHtmlForSubpath(html, mountPrefix);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(rewritten);
    return;
  }

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(candidate).pipe(res);
}

export function restoreActiveProcesses(): void {
  const sites = loadSites();
  for (const site of sites) {
    if (
      site.status === 'live' &&
      (site.detection.mode === 'node_server' ||
        site.detection.mode === 'python_server' ||
        site.detection.mode === 'java_server' ||
        site.detection.mode === 'php_server' ||
        site.detection.mode === 'go_server')
    ) {
      void buildAndLaunchSite(site.id);
    }
  }
}
