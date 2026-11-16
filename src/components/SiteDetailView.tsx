import {
  ArrowRight,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Folder,
  GitBranch,
  Globe,
  Loader2,
  Monitor,
  Pause,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  DomainVerifyResult,
  HealthInfo,
  SiteFileEntry,
  SiteRecord,
} from '../types';
import { safeFetchJson } from '../utils/api';
import {
  buildCustomDomainUrl,
  buildInternalPreviewPath,
  formatArabicDate,
  formatBytes,
} from '../utils/format';
import { StatusLabel } from './StatusLabel';

interface SiteDetailViewProps {
  site: SiteRecord;
  health: HealthInfo | null;
  onBack: () => void;
  onSiteUpdated: (site: SiteRecord) => void;
  onSiteDeleted: (siteId: string) => void;
}

type DetailTab = 'preview' | 'logs' | 'files' | 'dns';

export function SiteDetailView({
  site,
  health,
  onBack,
  onSiteUpdated,
  onSiteDeleted,
}: SiteDetailViewProps) {
  const [tab, setTab] = useState<DetailTab>('preview');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const [domainInput, setDomainInput] = useState(site.customDomain);
  const [nameInput, setNameInput] = useState(site.name);
  const [savingDomain, setSavingDomain] = useState(false);
  const [domainFeedback, setDomainFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [files, setFiles] = useState<SiteFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);

  const [verifyingDns, setVerifyingDns] = useState(false);
  const [verifyResult, setVerifyResult] = useState<DomainVerifyResult | null>(
    null,
  );

  const liveUrl = buildCustomDomainUrl(site.customDomain);
  const previewPath = buildInternalPreviewPath(site.customDomain);
  const workingRunUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${previewPath}`
      : previewPath;
  const isDnsConfigured = Boolean(
    verifyResult &&
      (verifyResult.dnsA.length > 0 || verifyResult.dnsCname.length > 0),
  );

  useEffect(() => {
    setDomainInput(site.customDomain);
    setNameInput(site.name);
    setVerifyResult(null);
  }, [site.id, site.customDomain, site.name]);

  useEffect(() => {
    let cancelled = false;
    async function checkDns() {
      try {
        const res = await fetch('/api/verify-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: site.customDomain }),
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as DomainVerifyResult;
          setVerifyResult(data);
        }
      } catch {
        // ignore passive DNS probe errors
      }
    }
    void checkDns();
    return () => {
      cancelled = true;
    };
  }, [site.customDomain]);

  useEffect(() => {
    if (site.status !== 'building' && site.status !== 'uploading') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/sites/${site.id}`);
        if (res.ok) {
          const fresh = (await res.json()) as SiteRecord;
          onSiteUpdated(fresh);
          if (fresh.status === 'live') {
            setIframeKey((k) => k + 1);
          }
        }
      } catch {
        // ignore
      }
    }, 600);
    return () => clearInterval(timer);
  }, [site.id, site.status, onSiteUpdated]);

  useEffect(() => {
    if (tab !== 'files') return;
    let cancelled = false;
    async function load() {
      setLoadingFiles(true);
      try {
        const res = await fetch(`/api/sites/${site.id}/files`);
        if (res.ok && !cancelled) {
          const list = (await res.json()) as SiteFileEntry[];
          setFiles(list);
          const readme = list.find(
            (f) => !f.isDirectory && f.path.toLowerCase() === 'readme.md',
          );
          const firstFile = readme || list.find((f) => !f.isDirectory);
          if (firstFile && !selectedFilePath) {
            void openFile(firstFile.path);
          }
        }
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, site.id]);

  async function openFile(relPath: string) {
    setSelectedFilePath(relPath);
    setLoadingContent(true);
    try {
      const res = await fetch(
        `/api/sites/${site.id}/file?path=${encodeURIComponent(relPath)}`,
      );
      const data = await res.json();
      setFileContent(
        res.ok ? String(data.content || '') : String(data.error || ''),
      );
    } catch {
      setFileContent('تعذر تحميل محتوى الملف');
    } finally {
      setLoadingContent(false);
    }
  }

  async function handleCopyUrl() {
    await navigator.clipboard.writeText(isDnsConfigured ? liveUrl : workingRunUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleSaveDomain(e: React.FormEvent) {
    e.preventDefault();
    setSavingDomain(true);
    setDomainFeedback(null);
    try {
      const updated = await safeFetchJson<SiteRecord>(`/api/sites/${site.id}/domain`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: domainInput,
          name: nameInput,
        }),
      });
      onSiteUpdated(updated);
      setDomainFeedback({
        type: 'ok',
        msg: 'تم تحديث الدومين المخصص وربطه فوراً.',
      });
      setIframeKey((k) => k + 1);
    } catch (err) {
      setDomainFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'فشل التحديث',
      });
    } finally {
      setSavingDomain(false);
    }
  }

  async function handleRebuild() {
    setBusyAction('rebuild');
    try {
      await safeFetchJson(`/api/sites/${site.id}/rebuild`, { method: 'POST' });
      const fresh = await safeFetchJson<SiteRecord>(`/api/sites/${site.id}`);
      onSiteUpdated(fresh);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStop() {
    setBusyAction('stop');
    try {
      const stopped = await safeFetchJson<SiteRecord>(`/api/sites/${site.id}/stop`, {
        method: 'POST',
      });
      onSiteUpdated(stopped);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    setBusyAction('delete');
    try {
      await safeFetchJson(`/api/sites/${site.id}`, { method: 'DELETE' });
      onSiteDeleted(site.id);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVerifyDns() {
    setVerifyingDns(true);
    try {
      const result = await safeFetchJson<DomainVerifyResult>('/api/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: site.customDomain }),
      });
      setVerifyResult(result);
    } finally {
      setVerifyingDns(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5 space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          <span>العودة إلى قائمة المشاريع</span>
        </button>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {site.name}
              </h1>
              <StatusLabel status={site.status} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
              <span className="font-mono text-teal-800 font-medium" dir="ltr">
                {site.customDomain}
              </span>
              <span aria-hidden="true">·</span>
              <span dir="ltr">{site.detection.framework}</span>
              <span aria-hidden="true">·</span>
              <span>{site.detection.fileCount} ملف</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(site.detection.totalBytes)}</span>
              <span aria-hidden="true">·</span>
              <span>آخر نشر {formatArabicDate(site.lastDeployedAt)}</span>
            </div>

            {site.sourceRepoUrl && (
              <div className="text-xs text-slate-600 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                <a
                  href={site.sourceRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="font-mono hover:underline"
                >
                  {site.sourceRepoUrl}
                </a>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyUrl()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                  <span>تم نسخ رابط التشغيل</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>
                    {isDnsConfigured
                      ? 'نسخ رابط الدومين'
                      : 'نسخ رابط التشغيل الفوري'}
                  </span>
                </>
              )}
            </button>

            <a
              href={previewPath}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>فتح المشروع الآن</span>
            </a>

            {isDnsConfigured ? (
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-700" />
                <span>فتح الدومين</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setTab('dns')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 whitespace-nowrap shrink-0"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>ربط الدومين (DNS)</span>
              </button>
            )}

            <a
              href={`/api/sites/${site.id}/download`}
              download
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تنزيل ZIP</span>
            </a>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleRebuild()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة بناء</span>
            </button>

            {site.port && site.status === 'live' && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleStop()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>إيقاف</span>
              </button>
            )}

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busyAction === 'delete'}
                  onClick={() => void handleDelete()}
                  className="px-3 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 whitespace-nowrap shrink-0"
                >
                  تأكيد الحذف
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  إلغاء
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-slate-500 shrink-0">رابط التشغيل الفوري:</span>
            <a
              href={previewPath}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="font-mono text-teal-800 hover:underline truncate"
            >
              {workingRunUrl}
            </a>
          </div>
          <span className="text-slate-500 shrink-0">{site.statusMessage}</span>
        </div>

        {verifyResult && !isDnsConfigured && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="leading-relaxed">
              <span className="font-semibold">
                لماذا لا يفتح {site.customDomain} مباشرة في المتصفح؟
              </span>{' '}
              {verifyResult.dnsError ||
                'لم يتم ضبط سجلات DNS العامة لهذا الدومين بعد.'}{' '}
              استخدم زر <span className="font-semibold">فتح المشروع الآن</span>{' '}
              أو <span className="font-semibold">نسخ رابط التشغيل الفوري</span>{' '}
              أعلاه ليفتح المشروع معك ومع أي مستخدم فوراً، أو اربط دوميناً حقيقياً
              مسجلاً عبر <span className="font-semibold">خطوات ربط الـ DNS</span>.
            </div>
            <button
              type="button"
              onClick={() => setTab('dns')}
              className="px-3 py-1.5 text-xs font-semibold text-amber-950 bg-white border border-amber-300 rounded-md hover:bg-amber-100 whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              إعداد الدومين الحقيقي
            </button>
          </div>
        )}
      </div>

      {/* Sub-navigation Tabs */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg overflow-x-auto max-w-full">
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
            tab === 'preview'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          <span>المعاينة والدومين</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('logs')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
            tab === 'logs'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>سجل البناء والتشغيل</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('files')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
            tab === 'files'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>ملفات المشروع</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('dns')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
            tab === 'dns'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>ربط الدومين (DNS)</span>
        </button>
      </div>

      {/* Tab 1: Live Preview + Custom Domain Editor */}
      {tab === 'preview' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  dir="ltr"
                  className="font-mono text-xs text-slate-700 truncate"
                >
                  {liveUrl}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewport('desktop')}
                  title="عرض سطح المكتب"
                  className={`p-1.5 rounded-md ${
                    viewport === 'desktop'
                      ? 'bg-white border border-slate-200 text-slate-900'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('mobile')}
                  title="عرض الجوال"
                  className={`p-1.5 rounded-md ${
                    viewport === 'mobile'
                      ? 'bg-white border border-slate-200 text-slate-900'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIframeKey((k) => k + 1)}
                  title="تحديث المعاينة"
                  className="p-1.5 rounded-md text-slate-500 hover:text-slate-800"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="bg-slate-100 p-4 flex justify-center min-h-[500px]">
              {site.status === 'building' ? (
                <div className="flex flex-col items-center justify-center text-center py-20 gap-3">
                  <Loader2 className="w-7 h-7 animate-spin text-teal-700" />
                  <p className="text-sm font-semibold text-slate-800">
                    جاري بناء وتشغيل المشروع...
                  </p>
                  <p className="text-xs text-slate-500">{site.statusMessage}</p>
                </div>
              ) : (
                <iframe
                  key={iframeKey}
                  src={previewPath}
                  title={`معاينة ${site.customDomain}`}
                  className={`bg-white border border-slate-200 rounded-lg h-[480px] transition-all ${
                    viewport === 'mobile' ? 'w-[375px]' : 'w-full'
                  }`}
                />
              )}
            </div>
          </div>

          <div className="xl:col-span-4 space-y-6">
            <form
              onSubmit={handleSaveDomain}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <h2 className="text-sm font-semibold text-slate-900">
                تعديل الدومين المخصص
              </h2>

              <div>
                <label
                  htmlFor="editDomain"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  الدومين
                </label>
                <input
                  id="editDomain"
                  type="text"
                  dir="ltr"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  className="w-full font-mono text-sm px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="editName"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  اسم المشروع
                </label>
                <input
                  id="editName"
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>

              {domainFeedback && (
                <p
                  className={`text-xs font-medium ${
                    domainFeedback.type === 'ok'
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                  }`}
                >
                  {domainFeedback.msg}
                </p>
              )}

              <button
                type="submit"
                disabled={savingDomain}
                className="w-full px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {savingDomain ? 'جاري الحفظ...' : 'حفظ الدومين المخصص'}
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">
                اللغات والملخص التلقائي
              </h2>

              {site.detection.languageStats &&
                site.detection.languageStats.length > 0 && (
                  <div className="space-y-2">
                    <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-100">
                      {site.detection.languageStats.map((stat) => (
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
                      className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 tabular-nums"
                      dir="ltr"
                    >
                      {site.detection.languageStats.map((stat) => (
                        <span
                          key={stat.name}
                          className="inline-flex items-center gap-1"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: stat.color }}
                          />
                          <span>{stat.name}</span>
                          <span className="text-slate-400">{stat.percent}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">اللغة</dt>
                  <dd className="font-semibold text-slate-900" dir="ltr">
                    {site.detection.language}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">إطار العمل</dt>
                  <dd className="font-semibold text-slate-900" dir="ltr">
                    {site.detection.framework}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">وضع التشغيل</dt>
                  <dd className="font-mono text-slate-800" dir="ltr">
                    {site.detection.mode}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">نقطة الدخول</dt>
                  <dd className="font-mono text-slate-800" dir="ltr">
                    {site.detection.entryFile || '—'}
                  </dd>
                </div>
                {site.port && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">المنفذ الداخلي</dt>
                    <dd className="font-mono text-slate-800 tabular-nums" dir="ltr">
                      127.0.0.1:{site.port}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Build & Runtime Logs */}
      {tab === 'logs' && (
        <div className="space-y-4">
          <div className="bg-slate-950 text-slate-100 rounded-xl border border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 text-xs text-slate-400">
              <span>مخرجات البناء والتشغيل الحية</span>
              <span className="font-mono tabular-nums" dir="ltr">
                {site.logs.length} lines
              </span>
            </div>
            <pre
              dir="ltr"
              className="p-4 text-xs font-mono leading-6 overflow-x-auto max-h-[460px] overflow-y-auto text-slate-200"
            >
              {site.logs.length > 0
                ? site.logs.join('\n')
                : 'لا توجد سجلات مسجلة بعد.'}
            </pre>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              توزيع الامتدادات المكتشفة في المشروع
            </h3>
            <div
              className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600 tabular-nums"
              dir="ltr"
            >
              {Object.entries(site.detection.extensions).map(([ext, count]) => (
                <span key={ext} className="font-mono">
                  <strong className="text-slate-900">{ext}</strong>: {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: GitHub-style File Explorer */}
      {tab === 'files' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden min-h-[480px]">
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-l border-slate-200 p-3 max-h-[520px] overflow-y-auto">
            <div className="text-xs font-semibold text-slate-500 px-2 pb-2 border-b border-slate-100 mb-2">
              شجرة الملفات ({files.filter((f) => !f.isDirectory).length})
            </div>
            {loadingFiles ? (
              <div className="p-4 text-xs text-slate-500">جاري تحميل الملفات...</div>
            ) : (
              <div className="space-y-0.5" dir="ltr">
                {files.map((entry) =>
                  entry.isDirectory ? (
                    <div
                      key={entry.path}
                      className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-slate-500"
                    >
                      <Folder className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{entry.path}/</span>
                    </div>
                  ) : (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => void openFile(entry.path)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs font-mono text-left transition-colors ${
                        selectedFilePath === entry.path
                          ? 'bg-teal-50 text-teal-900 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <FileCode2 className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{entry.path}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                        {formatBytes(entry.size)}
                      </span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-8 flex flex-col bg-slate-50/40">
            <div
              dir="ltr"
              className="px-4 py-2.5 border-b border-slate-200 bg-white text-xs font-mono text-slate-700"
            >
              {selectedFilePath || 'اختر ملفاً لعرض محتواه'}
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loadingContent ? (
                <div className="text-xs text-slate-500">جاري القراءة...</div>
              ) : selectedFilePath ? (
                <pre
                  dir="ltr"
                  className="text-xs font-mono leading-relaxed text-slate-800 whitespace-pre-wrap break-words"
                >
                  {fileContent}
                </pre>
              ) : (
                <div className="text-xs text-slate-500">
                  اختر أي ملف من القائمة لاستعراض الكود المصدري.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: DNS Setup & Host Verification */}
      {tab === 'dns' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                سجلات DNS المطلوبة لتشغيل الدومين لجميع المستخدمين
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                لكي يفتح{' '}
                <span className="font-mono text-slate-900" dir="ltr">
                  {site.customDomain}
                </span>{' '}
                في متصفح أي مستخدم على الإنترنت (دون خطأ{' '}
                <span className="font-mono" dir="ltr">
                  NXDOMAIN
                </span>
                )، يجب أن يكون النطاق مسجلاً بالفعل لدى مزود نطاقات (مثل
                Cloudflare أو Namecheap أو GoDaddy)، ثم إضافة السجلات التالية:
              </p>
            </div>

            {health?.serverless ? (
              <div className="space-y-4">
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-right text-xs border-collapse" dir="ltr">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-3 text-left">Type</th>
                        <th className="py-2.5 px-3 text-left">Name / Host</th>
                        <th className="py-2.5 px-3 text-left">Value / Target</th>
                        <th className="py-2.5 px-3 text-left">TTL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">A</td>
                        <td className="py-2.5 px-3">@</td>
                        <td className="py-2.5 px-3">76.76.21.21</td>
                        <td className="py-2.5 px-3 tabular-nums">Auto</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">CNAME</td>
                        <td className="py-2.5 px-3">www</td>
                        <td className="py-2.5 px-3">cname.vercel-dns.com</td>
                        <td className="py-2.5 px-3 tabular-nums">Auto</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 leading-relaxed">
                  عند تشغيل هذه المنصة على Vercel: أضف أيضاً{' '}
                  <span className="font-mono font-semibold" dir="ltr">
                    {site.customDomain}
                  </span>{' '}
                  داخل{' '}
                  <span className="font-mono" dir="ltr">
                    Project Settings → Domains
                  </span>{' '}
                  في لوحة Vercel، مع ملاحظة أن التخزين على Vercel مؤقت؛ ولتشغيل
                  دومينات مستضافة بشكل دائم لكل الزوار يُنصح بتثبيت المنصة على
                  سيرفر خاص (VPS) عبر{' '}
                  <span className="font-mono" dir="ltr">
                    npm start
                  </span>
                  .
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-right text-xs border-collapse" dir="ltr">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-3 text-left">Type</th>
                        <th className="py-2.5 px-3 text-left">Name / Host</th>
                        <th className="py-2.5 px-3 text-left">Value / Target</th>
                        <th className="py-2.5 px-3 text-left">TTL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">A</td>
                        <td className="py-2.5 px-3">@</td>
                        <td className="py-2.5 px-3">{health?.serverIp || 'YOUR_SERVER_IP'}</td>
                        <td className="py-2.5 px-3 tabular-nums">Auto</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">A</td>
                        <td className="py-2.5 px-3">www</td>
                        <td className="py-2.5 px-3">{health?.serverIp || 'YOUR_SERVER_IP'}</td>
                        <td className="py-2.5 px-3 tabular-nums">Auto</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-slate-200 pt-4 space-y-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    تفعيل HTTPS تلقائياً على خادمك الخاص (Caddy Reverse Proxy)
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    أضف هذا الإعداد على خادمك ليصدر شهادة SSL مجانية تلقائياً لأي
                    دومين تكتبه في لوحة الاستضافة:
                  </p>
                  <pre
                    dir="ltr"
                    className="bg-slate-950 text-slate-100 rounded-lg p-3.5 text-xs font-mono overflow-x-auto leading-relaxed"
                  >{`{
  on_demand_tls {
    ask http://127.0.0.1:3000/api/caddy-ask
  }
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy 127.0.0.1:3000
}`}</pre>
                </div>
              </>
            )}
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              اختبار توجيه الدومين (Host & DNS)
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              يتحقق هذا الفحص من جاهزية توجيه الترويسة{' '}
              <span className="font-mono" dir="ltr">
                Host: {site.customDomain}
              </span>{' '}
              على السيرفر بالإضافة إلى فحص سجلات DNS العامة.
            </p>

            <button
              type="button"
              disabled={verifyingDns}
              onClick={() => void handleVerifyDns()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              {verifyingDns ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>جاري الفحص...</span>
                </>
              ) : (
                <span>فحص الربط وسجلات DNS الآن</span>
              )}
            </button>

            {verifyResult && (
              <div className="border-t border-slate-200 pt-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">توجيه السيرفر الداخلي:</span>
                  <span
                    className={`font-semibold ${
                      verifyResult.hostRoutingReady
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {verifyResult.hostRoutingReady
                      ? `جاهز (HTTP ${verifyResult.hostRoutingStatus})`
                      : `حالة ${verifyResult.hostRoutingStatus}`}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 shrink-0">سجلات A العامة:</span>
                  <span className="font-mono text-slate-800 text-left" dir="ltr">
                    {verifyResult.dnsA.length > 0
                      ? verifyResult.dnsA.join(', ')
                      : 'غير مضبوطة'}
                  </span>
                </div>
                {verifyResult.dnsCname.length > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500 shrink-0">سجلات CNAME:</span>
                    <span className="font-mono text-slate-800 text-left" dir="ltr">
                      {verifyResult.dnsCname.join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
