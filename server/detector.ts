import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LanguageStat,
  ProjectDetection,
  RuntimeCapabilities,
} from './types.ts';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
]);

let cachedCapabilities: RuntimeCapabilities | null = null;

function probeCommand(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    })
      .toString()
      .trim();
    return out.split('\n')[0]?.trim() || 'available';
  } catch {
    return null;
  }
}

export function getRuntimeCapabilities(forceRefresh = false): RuntimeCapabilities {
  if (cachedCapabilities && !forceRefresh) {
    return cachedCapabilities;
  }
  cachedCapabilities = {
    node: probeCommand('node -v'),
    npm: probeCommand('npm -v'),
    python3: probeCommand('python3 --version'),
    java: probeCommand('java -version 2>&1'),
    javac: probeCommand('javac -version 2>&1'),
    mvn: probeCommand('mvn -v'),
    php: probeCommand('php -v'),
    go: probeCommand('go version'),
  };
  return cachedCapabilities;
}

export function unwrapSingleRootFolder(siteDir: string): boolean {
  let unwrapped = false;
  for (let depth = 0; depth < 4; depth++) {
    const entries = fs.readdirSync(siteDir, { withFileTypes: true }).filter(
      (e) => e.name !== '__MACOSX' && e.name !== '.DS_Store',
    );
    if (entries.length !== 1 || !entries[0]?.isDirectory()) {
      break;
    }
    const innerDir = path.join(siteDir, entries[0].name);
    const innerEntries = fs.readdirSync(innerDir);
    if (innerEntries.length === 0) {
      break;
    }
    for (const item of innerEntries) {
      const src = path.join(innerDir, item);
      const dest = path.join(siteDir, item);
      fs.renameSync(src, dest);
    }
    fs.rmSync(innerDir, { recursive: true, force: true });
    unwrapped = true;
  }
  return unwrapped;
}

interface ScannedFile {
  relPath: string;
  size: number;
  ext: string;
}

function walkProject(dir: string, baseDir: string, out: ScannedFile[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__MACOSX' || entry.name === '.DS_Store') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      walkProject(fullPath, baseDir, out);
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      const ext = path.extname(entry.name).toLowerCase() || '(no-ext)';
      out.push({ relPath, size: stat.size, ext });
    }
  }
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTextSafe(filePath: string, limit = 16384): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8').slice(0, limit);
  } catch {
    return '';
  }
}

const EXT_LANGUAGE_MAP: Record<string, { name: string; color: string }> = {
  '.tsx': { name: 'TypeScript (React)', color: '#3178c6' },
  '.ts': { name: 'TypeScript', color: '#3178c6' },
  '.jsx': { name: 'JavaScript (React)', color: '#f1e05a' },
  '.js': { name: 'JavaScript', color: '#f1e05a' },
  '.mjs': { name: 'JavaScript', color: '#f1e05a' },
  '.html': { name: 'HTML', color: '#e34c26' },
  '.htm': { name: 'HTML', color: '#e34c26' },
  '.css': { name: 'CSS', color: '#563d7c' },
  '.scss': { name: 'SCSS', color: '#c6538c' },
  '.java': { name: 'Java', color: '#b07219' },
  '.py': { name: 'Python', color: '#3572a5' },
  '.php': { name: 'PHP', color: '#4f5d95' },
  '.go': { name: 'Go', color: '#00add8' },
  '.vue': { name: 'Vue', color: '#41b883' },
  '.svelte': { name: 'Svelte', color: '#ff3e00' },
  '.json': { name: 'JSON', color: '#64748b' },
};

function computeLanguageStats(files: ScannedFile[]): LanguageStat[] {
  const byLang = new Map<string, { bytes: number; color: string }>();
  let totalCodeBytes = 0;

  for (const f of files) {
    const mapped = EXT_LANGUAGE_MAP[f.ext];
    if (!mapped) continue;
    totalCodeBytes += f.size;
    const prev = byLang.get(mapped.name);
    if (prev) {
      prev.bytes += f.size;
    } else {
      byLang.set(mapped.name, { bytes: f.size, color: mapped.color });
    }
  }

  if (totalCodeBytes === 0) return [];

  return Array.from(byLang.entries())
    .map(([name, info]) => ({
      name,
      bytes: info.bytes,
      percent: Math.round((info.bytes / totalCodeBytes) * 1000) / 10,
      color: info.color,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6);
}

function findScriptModuleInHtml(
  htmlText: string,
  htmlDir: string,
  fileSet: Set<string>,
): string | null {
  const regex = /<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null = regex.exec(htmlText);
  while (match) {
    const rawSrc = match[1] || '';
    if (!/^https?:\/\//i.test(rawSrc) && !rawSrc.startsWith('//')) {
      const cleaned = rawSrc.replace(/^\.\//, '').replace(/^\/+/, '');
      const joined = htmlDir && htmlDir !== '.' ? `${htmlDir}/${cleaned}` : cleaned;
      if (fileSet.has(joined) && /\.(tsx|jsx|ts|js|mjs)$/i.test(joined)) {
        return joined;
      }
      if (fileSet.has(cleaned) && /\.(tsx|jsx|ts|js|mjs)$/i.test(cleaned)) {
        return cleaned;
      }
    }
    match = regex.exec(htmlText);
  }
  return null;
}

export function detectProject(siteDir: string): ProjectDetection {
  const files: ScannedFile[] = [];
  walkProject(siteDir, siteDir, files);

  const extensions: Record<string, number> = {};
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.size;
    extensions[f.ext] = (extensions[f.ext] || 0) + 1;
  }
  const languageStats = computeLanguageStats(files);

  const fileSet = new Set(files.map((f) => f.relPath));

  const pkgPath = path.join(siteDir, 'package.json');
  const pkg = readJsonSafe(pkgPath);

  // 1. JavaScript / TypeScript / React / Node.js ecosystem
  if (pkg) {
    const deps = {
      ...((pkg.dependencies as Record<string, string>) || {}),
      ...((pkg.devDependencies as Record<string, string>) || {}),
    };
    const scripts = (pkg.scripts as Record<string, string>) || {};
    const hasReact = Boolean(deps.react || deps['react-dom']);
    const hasNext = Boolean(deps.next);
    const hasVite = Boolean(deps.vite);
    const hasVue = Boolean(deps.vue);
    const hasSvelte = Boolean(deps.svelte);
    const hasAstro = Boolean(deps.astro);
    const hasExpress = Boolean(deps.express || deps.fastify || deps.koa || deps.hono);
    const hasTsx = Boolean(extensions['.tsx'] || extensions['.ts']);

    const prebuiltDist =
      fileSet.has('dist/index.html')
        ? 'dist'
        : fileSet.has('build/index.html')
          ? 'build'
          : fileSet.has('out/index.html')
            ? 'out'
            : null;

    if (hasNext) {
      if (fileSet.has('out/index.html')) {
        return {
          language: hasTsx ? 'TypeScript / JavaScript' : 'JavaScript',
          framework: 'Next.js (Static Export)',
          runtime: 'Static / Node.js',
          mode: 'static',
          entryFile: 'out/index.html',
          outputDir: 'out',
          buildCommand: scripts.build || null,
          startCommand: null,
          confidence: 'high',
          notes: ['تم اكتشاف مجلد تصدير Next.js جاهز (out/index.html)'],
          fileCount: files.length,
          totalBytes,
          extensions,
          languageStats,
        };
      }
      return {
        language: hasTsx ? 'TypeScript / JavaScript' : 'JavaScript',
        framework: 'Next.js',
        runtime: 'Node.js',
        mode: scripts.start ? 'node_server' : 'node_build_static',
        entryFile: 'package.json',
        outputDir: '.next',
        buildCommand: scripts.build || 'next build',
        startCommand: scripts.start || 'npx next start',
        confidence: 'high',
        notes: ['تم اكتشاف مشروع Next.js من ملف package.json'],
        fileCount: files.length,
        totalBytes,
        extensions,
        languageStats,
      };
    }

    if (hasReact || hasVite || hasVue || hasSvelte || hasAstro) {
      const framework = hasReact
        ? hasVite
          ? 'React · Vite'
          : 'React'
        : hasVue
          ? 'Vue · Vite'
          : hasSvelte
            ? 'Svelte'
            : hasAstro
              ? 'Astro'
              : 'Vite Frontend';

      const hasCustomServer =
        hasExpress && (fileSet.has('server.ts') || fileSet.has('server.js'));

      if (hasCustomServer && scripts.start) {
        return {
          language: hasTsx ? 'TypeScript / React' : 'JavaScript / React',
          framework: `${framework} + Express`,
          runtime: 'Node.js',
          mode: 'node_server',
          entryFile: fileSet.has('server.ts') ? 'server.ts' : 'server.js',
          outputDir: prebuiltDist,
          buildCommand: scripts.build || null,
          startCommand: scripts.start,
          confidence: 'high',
          notes: ['مشروع Full-Stack يحتوي على واجهة وخادم Node.js'],
          fileCount: files.length,
          totalBytes,
          extensions,
          languageStats,
        };
      }

      if (prebuiltDist && !scripts.build) {
        return {
          language: hasTsx ? 'TypeScript / React' : 'JavaScript / React',
          framework,
          runtime: 'Static Web',
          mode: 'static',
          entryFile: `${prebuiltDist}/index.html`,
          outputDir: prebuiltDist,
          buildCommand: null,
          startCommand: null,
          confidence: 'high',
          notes: [`تم العثور على نسخة مبنية جاهزة داخل ${prebuiltDist}/`],
          fileCount: files.length,
          totalBytes,
          extensions,
          languageStats,
        };
      }

      return {
        language: hasTsx ? 'TypeScript / JSX' : 'JavaScript / JSX',
        framework,
        runtime: 'Node.js Build → Static',
        mode: prebuiltDist ? 'static' : 'node_build_static',
        entryFile: fileSet.has('index.html') ? 'index.html' : 'package.json',
        outputDir: prebuiltDist || 'dist',
        buildCommand: scripts.build || 'vite build',
        startCommand: null,
        confidence: 'high',
        notes: prebuiltDist
          ? [`نسخة مبنية جاهزة في ${prebuiltDist}/`]
          : ['سيتم تثبيت الحزم وبناء تطبيق الواجهة تلقائياً'],
        fileCount: files.length,
        totalBytes,
        extensions,
        languageStats,
      };
    }

    const mainField = typeof pkg.main === 'string' ? pkg.main : null;
    const nodeEntry =
      (mainField && fileSet.has(mainField) ? mainField : null) ||
      ['server.ts', 'server.js', 'index.ts', 'index.js', 'app.js', 'src/index.ts', 'src/index.js'].find(
        (candidate) => fileSet.has(candidate),
      ) ||
      null;

    if (scripts.start || hasExpress || nodeEntry) {
      return {
        language: hasTsx ? 'TypeScript (Node.js)' : 'JavaScript (Node.js)',
        framework: hasExpress ? 'Express / Node.js' : 'Node.js Server',
        runtime: 'Node.js',
        mode: 'node_server',
        entryFile: nodeEntry || 'package.json',
        outputDir: null,
        buildCommand: scripts.build || null,
        startCommand: scripts.start || (nodeEntry ? `node ${nodeEntry}` : null),
        confidence: 'high',
        notes: ['تم اكتشاف تطبيق خادم Node.js وسيتم تشغيله وربطه بالرابط مباشرة'],
        fileCount: files.length,
        totalBytes,
        extensions,
        languageStats,
      };
    }
  }

  // 2. HTML referencing React module/JSX OR standalone React JSX/TSX without package.json
  const htmlEntry =
    (fileSet.has('index.html') ? 'index.html' : null) ||
    (fileSet.has('public/index.html') ? 'public/index.html' : null) ||
    files.find((f) => f.ext === '.html' || f.ext === '.htm')?.relPath ||
    null;

  const htmlContent = htmlEntry ? readTextSafe(path.join(siteDir, htmlEntry)) : '';
  const htmlDir = htmlEntry ? path.dirname(htmlEntry) : '.';
  const htmlLinkedScript = htmlEntry
    ? findScriptModuleInHtml(htmlContent, htmlDir, fileSet)
    : null;

  // Priority: main/index entrypoints FIRST so App.tsx doesn't shadow main.tsx!
  const jsxEntry =
    (htmlLinkedScript && /\.(tsx|jsx)$/i.test(htmlLinkedScript) ? htmlLinkedScript : null) ||
    [
      'src/main.tsx',
      'src/main.jsx',
      'main.tsx',
      'main.jsx',
      'src/index.tsx',
      'src/index.jsx',
      'index.tsx',
      'index.jsx',
      'src/App.tsx',
      'src/App.jsx',
      'App.tsx',
      'App.jsx',
    ].find((c) => fileSet.has(c)) ||
    files.find((f) => f.ext === '.tsx' || f.ext === '.jsx')?.relPath ||
    null;

  if (jsxEntry) {
    return {
      language: jsxEntry.endsWith('.tsx') ? 'TypeScript / React' : 'JavaScript / React',
      framework: htmlEntry ? 'HTML + React (Auto-Bundled)' : 'React (Zero-Config JSX)',
      runtime: 'Built-in ESBuild → Static',
      mode: 'esbuild_react_static',
      entryFile: jsxEntry,
      outputDir: 'dist',
      buildCommand: 'esbuild bundle',
      startCommand: null,
      confidence: 'high',
      notes: [
        `تم اكتشاف كود React (${jsxEntry}) وسيتم تجميعه وتشغيله تلقائياً بدون الحاجة لـ package.json`,
      ],
      fileCount: files.length,
      totalBytes,
      extensions,
      languageStats,
    };
  }

  // 3. Java (Maven / Gradle / JAR / .java)
  const hasPom = fileSet.has('pom.xml');
  const hasGradle = fileSet.has('build.gradle') || fileSet.has('build.gradle.kts');
  const jarFile = files.find((f) => f.ext === '.jar')?.relPath || null;
  const javaFiles = files.filter((f) => f.ext === '.java');

  if (hasPom || hasGradle || jarFile || javaFiles.length > 0) {
    const pomText = hasPom ? readTextSafe(path.join(siteDir, 'pom.xml')) : '';
    const gradleText = hasGradle
      ? readTextSafe(path.join(siteDir, fileSet.has('build.gradle') ? 'build.gradle' : 'build.gradle.kts'))
      : '';
    const isSpring =
      pomText.includes('spring-boot') || gradleText.includes('spring-boot');

    const staticJavaWeb = [
      'src/main/resources/static/index.html',
      'src/main/resources/public/index.html',
      'src/main/webapp/index.html',
    ].find((c) => fileSet.has(c));

    const framework = isSpring
      ? 'Java · Spring Boot'
      : hasPom
        ? 'Java · Maven'
        : hasGradle
          ? 'Java · Gradle'
          : jarFile
            ? 'Java · Executable JAR'
            : 'Java SE';

    const mainJava =
      javaFiles.find((f) => /Main\.java$|Application\.java$|Server\.java$/i.test(f.relPath))
        ?.relPath ||
      javaFiles[0]?.relPath ||
      null;

    return {
      language: 'Java',
      framework,
      runtime: 'JVM (Java Runtime)',
      mode: 'java_server',
      entryFile: jarFile || (hasPom ? 'pom.xml' : hasGradle ? 'build.gradle' : mainJava),
      outputDir: staticJavaWeb ? path.dirname(staticJavaWeb) : null,
      buildCommand: hasPom
        ? 'mvn package -DskipTests'
        : hasGradle
          ? 'gradle build -x test'
          : mainJava
            ? `javac ${mainJava}`
            : null,
      startCommand: jarFile
        ? `java -jar ${jarFile}`
        : isSpring && hasPom
          ? 'mvn spring-boot:run'
          : mainJava
            ? `java ${mainJava}`
            : null,
      confidence: 'high',
      notes: staticJavaWeb
        ? [`تم اكتشاف مشروع ${framework} مع واجهة ويب ثابتة في ${path.dirname(staticJavaWeb)}`]
        : [`تم اكتشاف مشروع ${framework} (${javaFiles.length} ملف Java)`],
      fileCount: files.length,
      totalBytes,
      extensions,
      languageStats,
    };
  }

  // 4. Python (Flask / FastAPI / Django / Script)
  const hasReqs = fileSet.has('requirements.txt') || fileSet.has('pyproject.toml');
  const pyFiles = files.filter((f) => f.ext === '.py');
  if (hasReqs || pyFiles.length > 0) {
    const reqText = readTextSafe(path.join(siteDir, 'requirements.txt')).toLowerCase();
    const pyEntry =
      ['app.py', 'main.py', 'server.py', 'run.py', 'manage.py', 'wsgi.py'].find((c) =>
        fileSet.has(c),
      ) || pyFiles[0]?.relPath || null;

    const entryContent = pyEntry ? readTextSafe(path.join(siteDir, pyEntry)).toLowerCase() : '';
    const isFlask = reqText.includes('flask') || entryContent.includes('from flask') || entryContent.includes('import flask');
    const isFastAPI = reqText.includes('fastapi') || entryContent.includes('fastapi');
    const isDjango = fileSet.has('manage.py') || reqText.includes('django');

    const framework = isDjango
      ? 'Python · Django'
      : isFastAPI
        ? 'Python · FastAPI'
        : isFlask
          ? 'Python · Flask'
          : 'Python Web / HTTP';

    return {
      language: 'Python',
      framework,
      runtime: 'Python 3',
      mode: 'python_server',
      entryFile: pyEntry,
      outputDir: null,
      buildCommand: hasReqs ? 'pip install -r requirements.txt' : null,
      startCommand: pyEntry ? `python3 ${pyEntry}` : 'python3 -m http.server',
      confidence: 'high',
      notes: [`تم اكتشاف مشروع ${framework}`],
      fileCount: files.length,
      totalBytes,
      extensions,
      languageStats,
    };
  }

  // 5. PHP
  const phpFiles = files.filter((f) => f.ext === '.php');
  if (fileSet.has('composer.json') || phpFiles.length > 0) {
    const phpEntry = fileSet.has('public/index.php')
      ? 'public/index.php'
      : fileSet.has('index.php')
        ? 'index.php'
        : phpFiles[0]?.relPath || null;
    const isLaravel = fileSet.has('artisan');
    return {
      language: 'PHP',
      framework: isLaravel ? 'PHP · Laravel' : 'PHP',
      runtime: 'PHP CLI / FPM',
      mode: 'php_server',
      entryFile: phpEntry,
      outputDir: fileSet.has('public/index.php') ? 'public' : '.',
      buildCommand: fileSet.has('composer.json') ? 'composer install' : null,
      startCommand: 'php -S 127.0.0.1:$PORT',
      confidence: 'high',
      notes: [`تم اكتشاف مشروع ${isLaravel ? 'Laravel' : 'PHP'}`],
      fileCount: files.length,
      totalBytes,
      extensions,
      languageStats,
    };
  }

  // 6. Go
  if (fileSet.has('go.mod') || files.some((f) => f.ext === '.go')) {
    return {
      language: 'Go',
      framework: 'Go Web Service',
      runtime: 'Go Compiler',
      mode: 'go_server',
      entryFile: fileSet.has('main.go') ? 'main.go' : 'go.mod',
      outputDir: null,
      buildCommand: 'go build -o app .',
      startCommand: './app',
      confidence: 'high',
      notes: ['تم اكتشاف مشروع لغة Go'],
      fileCount: files.length,
      totalBytes,
      extensions,
      languageStats,
    };
  }

  // 7. HTML linked with React CDN / Babel / ES Modules OR Pure Static HTML/CSS/JS
  if (htmlEntry) {
    const lowerHtml = htmlContent.toLowerCase();
    const usesReact =
      lowerHtml.includes('react.production') ||
      lowerHtml.includes('react.development') ||
      lowerHtml.includes('unpkg.com/react') ||
      lowerHtml.includes('esm.sh/react') ||
      lowerHtml.includes('cdn.jsdelivr.net/npm/react') ||
      lowerHtml.includes('text/babel') ||
      Boolean(fileSet.has('assets') || files.some((f) => /^assets\/index-.*\.js$/i.test(f.relPath)));
    const usesTailwind = lowerHtml.includes('tailwindcss') || lowerHtml.includes('tailwind');
    const usesBootstrap = lowerHtml.includes('bootstrap');

    const framework = usesReact
      ? 'HTML + React'
      : usesTailwind
        ? 'HTML5 · Tailwind CSS'
        : usesBootstrap
          ? 'HTML5 · Bootstrap'
          : 'HTML5 · CSS · JavaScript';

    const outDir = path.dirname(htmlEntry) === '.' ? '.' : path.dirname(htmlEntry);

    return {
      language: usesReact ? 'HTML / React' : 'HTML / CSS / JS',
      framework,
      runtime: 'Static Web Server',
      mode: 'static',
      entryFile: htmlEntry,
      outputDir: outDir,
      buildCommand: null,
      startCommand: null,
      confidence: 'high',
      notes: [
        usesReact
          ? 'تم اكتشاف صفحة HTML مربوطة بـ React — تعمل مباشرة عبر الرابط الفوري'
          : 'موقع ويب ثابت — يعمل فوراً بدون خطوات بناء',
      ],
      fileCount: files.length,
      totalBytes,
      extensions,
      languageStats,
    };
  }

  // 8. Standalone Node JS/TS file without package.json
  const standaloneNode = files.find((f) => f.ext === '.js' || f.ext === '.mjs' || f.ext === '.ts');
  if (standaloneNode) {
    return {
      language: standaloneNode.ext === '.ts' ? 'TypeScript' : 'JavaScript',
      framework: 'Node.js Script',
      runtime: 'Node.js',
      mode: 'node_server',
      entryFile: standaloneNode.relPath,
      outputDir: null,
      buildCommand: null,
      startCommand: `node ${standaloneNode.relPath}`,
      confidence: 'medium',
      notes: ['تم اكتشاف ملف JavaScript/TypeScript منفرد'],
      fileCount: files.length,
      totalBytes,
      extensions,
      languageStats,
    };
  }

  return {
    language: 'ملفات غير مصنفة',
    framework: 'Static Files',
    runtime: 'File Server',
    mode: 'files_only',
    entryFile: files[0]?.relPath || null,
    outputDir: '.',
    buildCommand: null,
    startCommand: null,
    confidence: 'low',
    notes: ['تم رفع الملفات بنجاح، يمكنك استعراضها أو تحديد نقطة الدخول'],
    fileCount: files.length,
    totalBytes,
    extensions,
    languageStats,
  };
}
