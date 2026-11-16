import {
  Check,
  FileArchive,
  FolderUp,
  GitBranch,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import type {
  HealthInfo,
  ProjectDetection,
  SiteRecord,
  StarterTemplate,
} from '../types';
import { safeFetchJson, uploadAndInspectChunked } from '../utils/api';
import {
  buildCustomDomainUrl,
  formatBytes,
  normalizeDomainClient,
} from '../utils/format';
import {
  collectFromDropEvent,
  collectFromFileList,
  type CollectedUpload,
} from '../utils/folderUpload';

interface DeployViewProps {
  health: HealthInfo | null;
  templates: StarterTemplate[];
  onDeployed: (site: SiteRecord) => void;
}

export function DeployView({ health, templates, onDeployed }: DeployViewProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sourceMode, setSourceMode] = useState<'upload' | 'github'>('upload');
  const [upload, setUpload] = useState<CollectedUpload | null>(null);
  const [uploadSessionId, setUploadSessionId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const [repoUrl, setRepoUrl] = useState('');
  const [githubVerifiedUrl, setGithubVerifiedUrl] = useState<string | null>(
    null,
  );

  const [inspecting, setInspecting] = useState(false);
  const [detection, setDetection] = useState<ProjectDetection | null>(null);
  const [customDomain, setCustomDomain] = useState('');
  const [projectName, setProjectName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [templateDeployingId, setTemplateDeployingId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const normalizedDomain = normalizeDomainClient(customDomain);

  async function inspectSelectedUpload(item: CollectedUpload) {
    setUpload(item);
    setUploadSessionId(null);
    setUploadProgress(0);
    setGithubVerifiedUrl(null);
    setDetection(null);
    setError(null);

    const cleanLabel = item.label.replace(/\.(zip|html|htm)$/i, '');
    if (!projectName) {
      setProjectName(cleanLabel);
    }
    if (!customDomain) {
      const suggested = normalizeDomainClient(
        cleanLabel.replace(/[_\s]+/g, '-'),
      );
      if (suggested) {
        setCustomDomain(
          suggested.includes('.') ? suggested : `${suggested}.dev`,
        );
      }
    }

    setInspecting(true);
    try {
      const { uploadId, detection: detected } = await uploadAndInspectChunked(
        item,
        (pct) => setUploadProgress(pct),
      );
      setUploadSessionId(uploadId);
      setDetection(detected);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء رفع أو قراءة المشروع',
      );
    } finally {
      setInspecting(false);
    }
  }

  async function handleInspectGitHub() {
    if (!repoUrl.trim()) {
      setError('يرجى لصق رابط مستودع GitHub أولاً');
      return;
    }
    setInspecting(true);
    setDetection(null);
    setUpload(null);
    setUploadSessionId(null);
    setError(null);
    try {
      const data = await safeFetchJson<{
        repoName?: string;
        normalizedUrl?: string;
        detection: ProjectDetection;
      }>('/api/inspect-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
      });
      setDetection(data.detection);
      setGithubVerifiedUrl(String(data.normalizedUrl || repoUrl));
      if (!projectName && data.repoName) {
        setProjectName(String(data.repoName));
      }
      if (!customDomain && data.repoName) {
        const slug = normalizeDomainClient(String(data.repoName));
        if (slug) setCustomDomain(`${slug}.dev`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'تعذر الاتصال بمستودع GitHub',
      );
    } finally {
      setInspecting(false);
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setSourceMode('upload');
    const collected = await collectFromDropEvent(e.dataTransfer);
    if (collected) {
      await inspectSelectedUpload(collected);
    } else {
      setError('لم يتم العثور على ملفات صالحة داخل السحب والإفلات');
    }
  }

  async function handleDeploySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizedDomain) {
      setError('يرجى كتابة اسم الدومين المخصص بحروف إنجليزية (مثال: my-site.com)');
      return;
    }

    if (sourceMode === 'github') {
      if (!repoUrl.trim()) {
        setError('يرجى إدخال رابط مستودع GitHub');
        return;
      }
      setDeploying(true);
      setError(null);
      try {
        const site = await safeFetchJson<SiteRecord>('/api/deploy-github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoUrl,
            customDomain: normalizedDomain,
            name: projectName.trim() || normalizedDomain,
          }),
        });
        onDeployed(site);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر نشر المستودع');
      } finally {
        setDeploying(false);
      }
      return;
    }

    if (!uploadSessionId) {
      setError('يرجى رفع فولدر المشروع أو ملف ZIP أولاً');
      return;
    }

    setDeploying(true);
    setError(null);
    try {
      const site = await safeFetchJson<SiteRecord>(
        `/api/uploads/${encodeURIComponent(uploadSessionId)}/deploy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customDomain: normalizedDomain,
            name: projectName.trim() || normalizedDomain,
          }),
        },
      );
      onDeployed(site);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر نشر المشروع');
    } finally {
      setDeploying(false);
    }
  }

  async function handleDeployTemplate(tpl: StarterTemplate) {
    setTemplateDeployingId(tpl.id);
    setError(null);
    try {
      const uniqueSuffix = Math.floor(100 + Math.random() * 900);
      const domain = `${tpl.defaultDomain.replace(/\.dev$/, '')}-${uniqueSuffix}.dev`;
      const site = await safeFetchJson<SiteRecord>('/api/deploy-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: tpl.id,
          customDomain: domain,
          name: tpl.title,
        }),
      });
      onDeployed(site);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر نشر القالب');
    } finally {
      setTemplateDeployingId(null);
    }
  }

  function resetSelection() {
    setUpload(null);
    setUploadSessionId(null);
    setUploadProgress(0);
    setDetection(null);
    setGithubVerifiedUrl(null);
    setError(null);
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const canSubmit =
    Boolean(normalizedDomain) &&
    !deploying &&
    !inspecting &&
    (sourceMode === 'upload' ? Boolean(uploadSessionId) : Boolean(repoUrl.trim()));

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          نشر مشروع جديد على استضافتك الخاصة
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 max-w-2xl leading-relaxed">
          ارفع فولدر، ملف مضغوط ZIP، ملف HTML/React مباشرة، أو استورد مستودع
          GitHub؛ يقرأ الخادم اللغة تلقائياً ويربطه بدومينك المخصص بروابط تعمل
          فوراً.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 rounded-lg text-sm font-medium"
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleDeploySubmit}
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
      >
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                01. مصدر المشروع
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                يدعم React · HTML + React · Vite · Next.js · Node.js · Python · Java · PHP · Go
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start">
              <button
                type="button"
                onClick={() => {
                  setSourceMode('upload');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sourceMode === 'upload'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                رفع فولدر / ZIP
              </button>
              <button
                type="button"
                onClick={() => {
                  setSourceMode('github');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sourceMode === 'github'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                رابط GitHub
              </button>
            </div>
          </div>

          {sourceMode === 'upload' ? (
            <>
              <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is supported in Chromium/Safari/Firefox
                webkitdirectory=""
                directory=""
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    const collected = collectFromFileList(e.target.files, 'folder');
                    if (collected) void inspectSelectedUpload(collected);
                  }
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".zip,.html,.htm,.jsx,.tsx,.js,.css,application/zip"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    const collected = collectFromFileList(e.target.files, 'files');
                    if (collected) void inspectSelectedUpload(collected);
                  }
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => void handleDrop(e)}
                className={`border border-dashed rounded-xl p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-teal-600 bg-teal-50/50'
                    : 'border-slate-300 bg-slate-50/60 hover:border-slate-400'
                }`}
              >
                <UploadCloud className="w-9 h-9 mx-auto text-slate-400" />
                <p className="mt-3 text-sm font-semibold text-slate-800">
                  اسحب الفولدر أو ملف ZIP أو ملف HTML وأفلته هنا
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  يتم الرفع على دفعات آمنة مع استبعاد node_modules تلقائياً
                </p>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <FolderUp className="w-4 h-4 text-teal-700" />
                    <span>اختيار فولدر مشروع</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <FileArchive className="w-4 h-4 text-teal-700" />
                    <span>اختيار ZIP أو ملف HTML</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 border border-slate-200 bg-slate-50/50 rounded-xl p-5">
              <div>
                <label
                  htmlFor="githubRepoInput"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  رابط مستودع GitHub العام (Public Repository)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <GitBranch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="githubRepoInput"
                      type="text"
                      dir="ltr"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/username/my-react-app"
                      className="w-full font-mono text-sm pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={inspecting || !repoUrl.trim()}
                    onClick={() => void handleInspectGitHub()}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    جلب وفحص اللغة
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  يمكنك أيضاً تحديد فرع معين مثل{' '}
                  <span className="font-mono" dir="ltr">
                    owner/repo/tree/main
                  </span>
                </p>
              </div>
            </div>
          )}

          {inspecting && (
            <div className="border-t border-slate-200 pt-5 space-y-2.5">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-teal-700 shrink-0" />
                  <span>جاري رفع الملفات واكتشاف اللغة تلقائياً...</span>
                </span>
                {uploadProgress > 0 && (
                  <span className="font-mono text-xs tabular-nums text-teal-800">
                    {uploadProgress}%
                  </span>
                )}
              </div>
              {uploadProgress > 0 && (
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-700 transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {!inspecting && detection && (
            <div className="border-t border-slate-200 pt-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-semibold text-teal-700 inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  <span>
                    {githubVerifiedUrl
                      ? 'تم جلب المستودع وقراءة اللغة تلقائياً'
                      : 'تم رفع الملفات وقراءة اللغة تلقائياً'}
                  </span>
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 tabular-nums">
                    {detection.fileCount} ملف · {formatBytes(detection.totalBytes)}
                  </span>
                  {(upload || githubVerifiedUrl) && (
                    <button
                      type="button"
                      onClick={resetSelection}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 whitespace-nowrap"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>مسح</span>
                    </button>
                  )}
                </div>
              </div>

              {detection.languageStats && detection.languageStats.length > 0 && (
                <div className="space-y-2">
                  <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-100">
                    {detection.languageStats.map((stat) => (
                      <div
                        key={stat.name}
                        style={{
                          width: `${Math.max(stat.percent, 2)}%`,
                          backgroundColor: stat.color,
                        }}
                        title={`${stat.name}: ${stat.percent}%`}
                      />
                    ))}
                  </div>
                  <div
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums"
                    dir="ltr"
                  >
                    {detection.languageStats.map((stat) => (
                      <span
                        key={stat.name}
                        className="inline-flex items-center gap-1.5"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: stat.color }}
                        />
                        <span className="font-medium text-slate-800">
                          {stat.name}
                        </span>
                        <span className="text-slate-500">{stat.percent}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">اللغة المكتشفة</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5" dir="ltr">
                    {detection.language}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">إطار العمل</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5" dir="ltr">
                    {detection.framework}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">نقطة الدخول</dt>
                  <dd className="font-mono text-xs text-slate-800 mt-0.5" dir="ltr">
                    {detection.entryFile || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">بيئة التشغيل</dt>
                  <dd className="text-xs font-medium text-slate-800 mt-0.5" dir="ltr">
                    {detection.runtime}
                  </dd>
                </div>
              </dl>

              {detection.notes.length > 0 && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
                  {detection.notes[0]}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              02. الدومين المخصص والتشغيل
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              اكتب الدومين الخاص بك يدوياً ليتم ربط المشروع به فوراً
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="customDomainInput"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                الدومين المخصص (بحروف إنجليزية)
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="customDomainInput"
                  type="text"
                  dir="ltr"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="my-project.com"
                  className="w-full font-mono text-sm pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                  required
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                مثال:{' '}
                <span className="font-mono" dir="ltr">
                  ahmed.dev
                </span>{' '}
                أو{' '}
                <span className="font-mono" dir="ltr">
                  shop.mysite.com
                </span>
              </p>
            </div>

            <div>
              <label
                htmlFor="projectNameInput"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                اسم المشروع في اللوحة (اختياري)
              </label>
              <input
                id="projectNameInput"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="موقعي الشخصي"
                className="w-full text-sm px-3.5 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
              />
            </div>

            {normalizedDomain && (
              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <div>
                  <span className="text-xs text-slate-500 block">
                    دومين المشروع الخاص بك:
                  </span>
                  <span
                    className="font-mono text-xs text-teal-800 break-all"
                    dir="ltr"
                  >
                    {buildCustomDomainUrl(normalizedDomain)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">
                    توجيه DNS المطلوب (سجل A):
                  </span>
                  <span className="font-mono text-xs text-slate-700" dir="ltr">
                    @ → {health?.serverIp || 'YOUR_SERVER_IP'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {deploying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري التشغيل والربط...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>تشغيل المشروع على الدومين الآن</span>
              </>
            )}
          </button>
        </div>
      </form>

      <div className="border-t border-slate-200 pt-8 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            قوالب اختبار حقيقية (تجربة سريعة بنقرة واحدة)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إذا لم يكن لديك ملف مضغوط جاهز الآن، اختبر اكتشاف اللغات والنشر الفوري بهذه المشاريع الكاملة
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {templates.map((tpl) => {
            const busy = templateDeployingId === tpl.id;
            return (
              <div
                key={tpl.id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="text-xs text-slate-500" dir="ltr">
                    {tpl.language} · {tpl.fileCount} files
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 mt-1.5">
                    {tpl.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    {tpl.description}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={Boolean(templateDeployingId)}
                  onClick={() => void handleDeployTemplate(tpl)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>جاري النشر...</span>
                    </>
                  ) : (
                    <span>تشغيل هذا القالب</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
