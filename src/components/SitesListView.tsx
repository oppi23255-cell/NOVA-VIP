import {
  Check,
  Copy,
  ExternalLink,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { HealthInfo, SiteRecord } from '../types';
import {
  buildLiveUrl,
  formatArabicDate,
  formatBytes,
} from '../utils/format';
import { StatusLabel } from './StatusLabel';

interface SitesListViewProps {
  sites: SiteRecord[];
  health: HealthInfo | null;
  loading: boolean;
  onSelectSite: (siteId: string) => void;
  onGoDeploy: () => void;
}

export function SitesListView({
  sites,
  health,
  loading,
  onSelectSite,
  onGoDeploy,
}: SitesListViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'live' | 'other'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const origin = health?.origin || window.location.origin;

  const filteredSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((site) => {
      if (filter === 'live' && site.status !== 'live') return false;
      if (filter === 'other' && site.status === 'live') return false;
      if (!q) return true;
      return (
        site.name.toLowerCase().includes(q) ||
        site.customDomain.toLowerCase().includes(q) ||
        site.detection.language.toLowerCase().includes(q) ||
        site.detection.framework.toLowerCase().includes(q)
      );
    });
  }, [sites, query, filter]);

  async function handleCopy(e: React.MouseEvent, site: SiteRecord) {
    e.stopPropagation();
    const url = buildLiveUrl(origin, site.customDomain);
    await navigator.clipboard.writeText(url);
    setCopiedId(site.id);
    setTimeout(() => setCopiedId(null), 1800);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            المشاريع المستضافة
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            إدارة جميع المواقع والتطبيقات المرفوعة، مع الروابط المباشرة والدومينات المخصصة
          </p>
        </div>
        <button
          type="button"
          onClick={onGoDeploy}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>رفع مشروع جديد</span>
        </button>
      </div>

      {/* Summary metrics strip (unboxed hairline grid) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">إجمالي المشاريع</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {sites.length}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">تعمل الآن</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
            {sites.filter((s) => s.status === 'live').length}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">دومينات مربوطة</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {sites.length}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">إجمالي الملفات المستضافة</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {sites.reduce((acc, s) => acc + s.detection.fileCount, 0)}
          </div>
        </div>
      </div>

      {/* Search and segmented status filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المشروع، الدومين، أو اللغة..."
            className="w-full text-sm pr-9 pl-3.5 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
          />
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الكل ({sites.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('live')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'live'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            يعمل الآن ({sites.filter((s) => s.status === 'live').length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('other')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'other'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            حالات أخرى ({sites.filter((s) => s.status !== 'live').length})
          </button>
        </div>
      </div>

      {/* Sites Table / List */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          {[1, 2, 3].map((row) => (
            <div key={row} className="p-5 flex items-center justify-between animate-pulse">
              <div className="space-y-2">
                <div className="h-4 w-40 bg-slate-200 rounded" />
                <div className="h-3 w-64 bg-slate-100 rounded" />
              </div>
              <div className="h-8 w-24 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : filteredSites.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            {sites.length === 0
              ? 'لا توجد مشاريع مستضافة بعد'
              : 'لا توجد نتائج مطابقة للبحث'}
          </h2>
          <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
            {sites.length === 0
              ? 'ارفع فولدر مشروعك أو ملف ZIP الآن ليتم اكتشاف لغته تلقائياً ونشره على دومينك المخصص.'
              : 'جرّب البحث بكلمة أخرى أو تصفية الكل.'}
          </p>
          {sites.length === 0 && (
            <button
              type="button"
              onClick={onGoDeploy}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>نشر أول مشروع الآن</span>
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">المشروع والدومين</th>
                  <th className="py-3 px-4">اللغة وإطار العمل</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4">آخر نشر</th>
                  <th className="py-3 px-4 text-left">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredSites.map((site) => {
                  const liveUrl = buildLiveUrl(origin, site.customDomain);
                  return (
                    <tr
                      key={site.id}
                      onClick={() => onSelectSite(site.id)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">
                          {site.name}
                        </div>
                        <div
                          className="font-mono text-xs text-teal-700 mt-0.5"
                          dir="ltr"
                        >
                          {site.customDomain}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-slate-800 font-medium" dir="ltr">
                          {site.detection.framework}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {site.detection.language} · {site.detection.fileCount} ملف ·{' '}
                          {formatBytes(site.detection.totalBytes)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusLabel status={site.status} />
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatArabicDate(site.lastDeployedAt)}
                      </td>
                      <td
                        className="py-3.5 px-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => void handleCopy(e, site)}
                            title="نسخ الرابط المباشر"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
                          >
                            {copiedId === site.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-700" />
                                <span>تم النسخ</span>
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
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 whitespace-nowrap shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>فتح</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => onSelectSite(site.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap shrink-0"
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                            <span>إدارة</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
