import { Check, Copy, ExternalLink, Globe, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { DomainVerifyResult, HealthInfo, SiteRecord } from '../types';
import { buildLiveUrl } from '../utils/format';
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
  const [probeResult, setProbeResult] = useState<DomainVerifyResult | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const origin = health?.origin || window.location.origin;

  async function handleProbe(e: React.FormEvent) {
    e.preventDefault();
    if (!probeDomain.trim()) return;
    setProbing(true);
    try {
      const res = await fetch('/api/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: probeDomain }),
      });
      if (res.ok) {
        setProbeResult((await res.json()) as DomainVerifyResult);
      }
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          الدومينات المخصصة والتوجيه
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
          كل مشروع تنشره يحصل على رابط مباشر فوري ويعمل تلقائياً عبر ترويسة{' '}
          <span className="font-mono" dir="ltr">
            Host
          </span>{' '}
          عند ربط دومينك الشخصي بعنوان الخادم.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
            <h2 className="text-sm font-semibold text-slate-900">
              خريطة الدومينات المسجلة ({sites.length})
            </h2>
          </div>
          {sites.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              لم تقم بربط أي دومين بعد. ارفع مشروعك الأول لتسجيل الدومين.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {sites.map((site) => {
                const liveUrl = buildLiveUrl(origin, site.customDomain);
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
                          await navigator.clipboard.writeText(liveUrl);
                          setCopiedId(site.id);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
                      >
                        {copiedId === site.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                            <span>نسخ</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>نسخ الرابط</span>
                          </>
                        )}
                      </button>
                      <a
                        href={liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>زيارة</span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            أداة فحص الدومين المباشر
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

          {probeResult && (
            <div className="border-t border-slate-200 pt-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">مسجل في الاستضافة:</span>
                <span className="font-semibold text-slate-900">
                  {probeResult.registered ? 'نعم' : 'غير مسجل'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">استجابة توجيه Host:</span>
                <span className="font-mono text-slate-800" dir="ltr">
                  HTTP {probeResult.hostRoutingStatus}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500 shrink-0">سجلات DNS A:</span>
                <span className="font-mono text-slate-800" dir="ltr">
                  {probeResult.dnsA.length > 0
                    ? probeResult.dnsA.join(', ')
                    : 'لا يوجد'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
