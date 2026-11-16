import { Check, Copy, ExternalLink, Globe, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { DomainVerifyResult, HealthInfo, SiteRecord } from '../types';
import {
  buildCustomDomainUrl,
  buildInternalPreviewPath,
} from '../utils/format';
import { safeFetchJson } from '../utils/api';
import { StatusLabel } from './StatusLabel';

interface DomainsViewProps {
  sites: SiteRecord[];
  health: HealthInfo | null;
  onSelectSite: (siteId: string) => void;
}

export function DomainsView({
  sites,
  health,
  onSelectSite,
}: DomainsViewProps) {
  const [probeDomain, setProbeDomain] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<DomainVerifyResult | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customIp, setCustomIp] = useState('');

  const serverIp = customIp.trim() || health?.serverIp || 'YOUR_SERVER_IP';

  async function handleProbe(e: React.FormEvent) {
    e.preventDefault();
    if (!probeDomain.trim()) return;
    setProbing(true);
    setProbeError(null);
    try {
      const result = await safeFetchJson<DomainVerifyResult>('/api/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: probeDomain }),
      });
      setProbeResult(result);
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'تعذر فحص الدومين');
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          الدومينات المخصصة والـ DNS
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
          كل مشروع معزول بالكامل على الدومين الذي تكتبه بيدك، ويعمل مباشرة عبر
          سجلات الـ DNS وترويسة{' '}
          <span className="font-mono" dir="ltr">
            Host
          </span>{' '}
          بدون إظهار دومين الاستضافة.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
            <h2 className="text-sm font-semibold text-slate-900">
              خريطة الدومينات الخاصة بك ({sites.length})
            </h2>
          </div>
          {sites.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              لم تقم بربط أي دومين بعد. ارفع مشروعك الأول لتسجيل الدومين.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {sites.map((site) => {
                const customUrl = buildCustomDomainUrl(site.customDomain);
                return (
                  <div
                    key={site.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onSelectSite(site.id)}
                          dir="ltr"
                          className="font-mono text-sm font-semibold text-teal-800 hover:underline truncate"
                        >
                          {site.customDomain}
                        </button>
                        <StatusLabel status={site.status} />
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {site.name} · {site.detection.framework}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(customUrl);
                          setCopiedId(site.id);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
                      >
                        {copiedId === site.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                            <span>تم النسخ</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>نسخ الدومين</span>
                          </>
                        )}
                      </button>
                      <a
                        href={buildInternalPreviewPath(site.customDomain)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>فتح المشروع</span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">
              أداة فحص الدومين والـ DNS
            </h2>
            <form onSubmit={handleProbe} className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  dir="ltr"
                  value={probeDomain}
                  onChange={(e) => setProbeDomain(e.target.value)}
                  placeholder="example.com"
                  className="w-full font-mono text-sm pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                />
              </div>
              <button
                type="submit"
                disabled={probing}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {probing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'فحص'
                )}
              </button>
            </form>

            {probeError && (
              <p className="text-xs text-rose-700">{probeError}</p>
            )}

            {probeResult && (
              <div className="border-t border-slate-200 pt-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">مسجل في الاستضافة:</span>
                  <span className="font-semibold text-slate-900">
                    {probeResult.registered ? 'نعم' : 'غير مسجل'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">جاهزية توجيه Host:</span>
                  <span
                    className={`font-semibold ${
                      probeResult.hostRoutingReady
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {probeResult.hostRoutingReady
                      ? `يعمل (HTTP ${probeResult.hostRoutingStatus})`
                      : `HTTP ${probeResult.hostRoutingStatus}`}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 shrink-0">سجلات DNS A:</span>
                  <span className="font-mono text-slate-800" dir="ltr">
                    {probeResult.dnsA.length > 0
                      ? probeResult.dnsA.join(', ')
                      : 'غير مضبوطة بعد'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {health?.serverless
                ? 'سجلات DNS على Vercel (أو سيرفر VPS)'
                : 'عنوان IP الخاص بخادمك (لسجلات A)'}
            </h2>
            {health?.serverless ? (
              <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
                <div>
                  سجل <span className="font-mono font-semibold" dir="ltr">A</span> لـ{' '}
                  <span className="font-mono" dir="ltr">@</span>:{' '}
                  <span className="font-mono font-semibold text-slate-900" dir="ltr">
                    76.76.21.21
                  </span>
                </div>
                <div>
                  سجل{' '}
                  <span className="font-mono font-semibold" dir="ltr">CNAME</span>{' '}
                  لـ <span className="font-mono" dir="ltr">www</span>:{' '}
                  <span className="font-mono font-semibold text-slate-900" dir="ltr">
                    cname.vercel-dns.com
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 pt-1">
                  ملاحظة: يجب أن يكون الدومين مسجلاً فعلياً لدى مزود نطاقات ومضافاً في{' '}
                  <span className="font-mono" dir="ltr">Vercel → Domains</span>، كما
                  يُنصح بتشغيل المنصة على VPS لتخزين دائم وعنوان IP ثابت.
                </p>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  dir="ltr"
                  value={customIp}
                  onChange={(e) => setCustomIp(e.target.value)}
                  placeholder={health?.serverIp || 'أدخل IP الخادم'}
                  className="w-full font-mono text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                />
                <div className="text-xs text-slate-600 space-y-1">
                  <div>
                    أضف سجل <span className="font-mono font-semibold" dir="ltr">A</span>{' '}
                    لـ <span className="font-mono" dir="ltr">@</span> و{' '}
                    <span className="font-mono" dir="ltr">www</span> يشير إلى:{' '}
                    <span className="font-mono font-semibold text-slate-900" dir="ltr">
                      {serverIp}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
