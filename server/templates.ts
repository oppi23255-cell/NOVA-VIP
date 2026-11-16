export interface StarterTemplateSpec {
  id: string;
  title: string;
  language: string;
  description: string;
  defaultDomain: string;
  files: Array<{ relPath: string; content: string }>;
}

export const STARTER_TEMPLATES: StarterTemplateSpec[] = [
  {
    id: 'html-portfolio',
    title: 'صفحة تعريفية HTML5 + CSS',
    language: 'HTML / CSS / JS',
    description: 'موقع ويب سريع الاستجابة يعمل فوراً بدون خطوات بناء.',
    defaultDomain: 'portfolio-site.dev',
    files: [
      {
        relPath: 'index.html',
        content: `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>موقعي الشخصي</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main class="wrap">
    <header class="top">
      <span class="brand">استوديو الأعمال</span>
      <nav><a href="#work">الأعمال</a> · <a href="#contact">تواصل</a></nav>
    </header>
    <section class="hero">
      <h1>موقع ويب منشور على استضافتك الخاصة</h1>
      <p>تم اكتشاف لغة HTML تلقائياً وربط الموقع بالدومين المخصص بنجاح.</p>
      <button id="pingBtn">اختبار التفاعل الفوري</button>
      <p id="pingOut" class="note"></p>
    </section>
  </main>
  <script src="./app.js"></script>
</body>
</html>`,
      },
      {
        relPath: 'style.css',
        content: `body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; }
.wrap { max-width: 820px; margin: 0 auto; padding: 48px 24px; }
.top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 24px; border-bottom: 1px solid #e2e8f0; }
.brand { font-weight: 700; font-size: 18px; }
.top nav a { color: #475569; text-decoration: none; }
.hero { padding: 64px 0; }
h1 { font-size: 36px; line-height: 1.25; margin: 0 0 16px; }
p { color: #475569; font-size: 17px; line-height: 1.7; }
button { margin-top: 20px; background: #0f766e; color: #fff; border: 0; padding: 12px 24px; border-radius: 8px; font-size: 15px; cursor: pointer; }
button:hover { background: #115e59; }
.note { margin-top: 14px; font-weight: 600; color: #0f766e; }`,
      },
      {
        relPath: 'app.js',
        content: `document.getElementById('pingBtn')?.addEventListener('click', () => {
  const el = document.getElementById('pingOut');
  if (el) el.textContent = 'الموقع يعمل بكفاءة على الدومين الخاص بك — ' + new Date().toLocaleTimeString('ar-EG');
});`,
      },
    ],
  },
  {
    id: 'react-zero-config',
    title: 'تطبيق React تفاعلي',
    language: 'TypeScript / React',
    description: 'تطبيق React يتم اكتشافه وتجميعه تلقائياً عبر المحرك المدمج.',
    defaultDomain: 'react-app.dev',
    files: [
      {
        relPath: 'index.html',
        content: `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>تطبيق React المستضاف</title>
</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a">
  <div id="root"></div>
  <script type="module" src="./src/App.tsx"></script>
</body>
</html>`,
      },
      {
        relPath: 'src/App.tsx',
        content: `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [count, setCount] = useState(1);
  return (
    <div style={{ maxWidth: 680, margin: '64px auto', padding: 32, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <h1 style={{ marginTop: 0 }}>تطبيق React يعمل على استضافتك</h1>
      <p style={{ color: '#475569', lineHeight: 1.7 }}>
        تم رفع كود React واكتشاف نوعه تلقائياً وتجميعه وتشغيله مباشرة على رابطك المخصص.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 24 }}>
        <button
          onClick={() => setCount((c) => c + 1)}
          style={{ background: '#0f766e', color: '#fff', border: 0, padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}
        >
          زيادة العداد ({count})
        </button>
        <span style={{ color: '#64748b', fontSize: 14 }}>حالة المكون: تفاعلي ومباشر</span>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);
`,
      },
    ],
  },
  {
    id: 'node-api-server',
    title: 'خادم Node.js HTTP + API',
    language: 'JavaScript (Node.js)',
    description: 'خادم Node.js حقيقي يعمل على منفذ داخلي مع نقطة نهاية JSON وواجهة ويب.',
    defaultDomain: 'api-service.dev',
    files: [
      {
        relPath: 'package.json',
        content: JSON.stringify(
          {
            name: 'node-hosted-service',
            version: '1.0.0',
            main: 'server.js',
            scripts: { start: 'node server.js' },
          },
          null,
          2,
        ),
      },
      {
        relPath: 'server.js',
        content: `const http = require('node:http');
const port = Number(process.env.PORT) || 4000;

const server = http.createServer((req, res) => {
  if (req.url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', runtime: 'Node.js ' + process.version, time: new Date().toISOString() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(\`<!doctype html><html lang="ar" dir="rtl"><body style="font-family:system-ui;max-width:680px;margin:60px auto;padding:24px">
    <h1>خادم Node.js يعمل مباشرة</h1>
    <p>هذه الصفحة صادرة من عملية Node.js حقيقية خلف البروكسي العكسي على المنفذ \${port}.</p>
    <p><a href="./api/info">عرض استجابة /api/info بصيغة JSON</a></p>
  </body></html>\`);
});

server.listen(port, '127.0.0.1', () => {
  console.log('Node server listening on port', port);
});`,
      },
    ],
  },
  {
    id: 'java-spring-sample',
    title: 'مشروع Java Spring Boot (Maven)',
    language: 'Java',
    description: 'بنية مشروع Java Maven القياسية مع واجهة ويب ثابتة في resources/static.',
    defaultDomain: 'java-spring.dev',
    files: [
      {
        relPath: 'pom.xml',
        content: `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.modif</groupId>
  <artifactId>demo-service</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>`,
      },
      {
        relPath: 'src/main/java/com/modif/Application.java',
        content: `package com.modif;

public class Application {
    public static void main(String[] args) {
        System.out.println("Java Spring Boot Application Ready");
    }
}`,
      },
      {
        relPath: 'src/main/resources/static/index.html',
        content: `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8" /><title>مشروع Java Spring Boot</title></head>
<body style="font-family:system-ui;max-width:680px;margin:60px auto;padding:24px;background:#f8fafc;color:#0f172a">
  <h1>واجهة مشروع Java · Spring Boot</h1>
  <p>تم اكتشاف pom.xml وهيكلة Java تلقائياً، ويتم تقديم الواجهة الثابتة من src/main/resources/static.</p>
</body>
</html>`,
      },
    ],
  },
];
