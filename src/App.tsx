import { Cpu, Globe, Layers, Plus, Server, UploadCloud } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DeployView } from './components/DeployView';
import { DomainsView } from './components/DomainsView';
import { RuntimesView } from './components/RuntimesView';
import { SiteDetailView } from './components/SiteDetailView';
import { SitesListView } from './components/SitesListView';
import type { HealthInfo, SiteRecord, StarterTemplate } from './types';

type ActiveSection = 'sites' | 'deploy' | 'domains' | 'runtimes';

export default function App() {
  const [section, setSection] = useState<ActiveSection>('deploy');
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [templates, setTemplates] = useState<StarterTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, sitesRes, tplRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/sites'),
        fetch('/api/templates'),
      ]);
      if (healthRes.ok) {
        setHealth((await healthRes.json()) as HealthInfo);
      }
      if (sitesRes.ok) {
        const list = (await sitesRes.json()) as SiteRecord[];
        setSites(list);
        if (list.length > 0) {
          setSection('sites');
        }
      }
      if (tplRes.ok) {
        setTemplates((await tplRes.json()) as StarterTemplate[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const selectedSite =
    sites.find((s) => s.id === selectedSiteId) || null;

  function handleDeployed(newSite: SiteRecord) {
    setSites((prev) => {
      const without = prev.filter((s) => s.id !== newSite.id);
      return [newSite, ...without];
    });
    setSelectedSiteId(newSite.id);
    setSection('sites');
  }

  function handleSiteUpdated(updated: SiteRecord) {
    setSites((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    );
  }

  function handleSiteDeleted(deletedId: string) {
    setSites((prev) => prev.filter((s) => s.id !== deletedId));
    setSelectedSiteId(null);
    setSection('sites');
  }

  function navigateSection(next: ActiveSection) {
    setSelectedSiteId(null);
    setSection(next);
  }

  const breadcrumbLabel = selectedSite
    ? `المشاريع المستضافة / ${selectedSite.customDomain}`
    : section === 'sites'
      ? 'المشاريع المستضافة'
      : section === 'deploy'
        ? 'نشر مشروع جديد'
        : section === 'domains'
          ? 'الدومينات والـ DNS'
          : 'بيئة التشغيل';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar (RTL right side) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 bg-white border-l border-slate-200">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <button
            type="button"
            onClick={() => navigateSection('sites')}
            className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <Server className="w-5 h-5 text-teal-700 shrink-0" />
            <span>مضيف</span>
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <button
            type="button"
            onClick={() => navigateSection('sites')}
            className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              section === 'sites' && !selectedSite
                ? 'bg-slate-100 text-slate-900 font-semibold'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <Layers className="w-4 h-4 shrink-0" />
              <span>المشاريع المستضافة</span>
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {sites.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigateSection('deploy')}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              section === 'deploy'
                ? 'bg-slate-100 text-slate-900 font-semibold'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <UploadCloud className="w-4 h-4 shrink-0" />
            <span>نشر مشروع جديد</span>
          </button>

          <button
            type="button"
            onClick={() => navigateSection('domains')}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              section === 'domains'
                ? 'bg-slate-100 text-slate-900 font-semibold'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Globe className="w-4 h-4 shrink-0" />
            <span>الدومينات والـ DNS</span>
          </button>

          <button
            type="button"
            onClick={() => navigateSection('runtimes')}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              section === 'runtimes'
                ? 'bg-slate-100 text-slate-900 font-semibold'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Cpu className="w-4 h-4 shrink-0" />
            <span>بيئة التشغيل</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
          استضافة ذاتية الملكية
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Brand/Breadcrumb — Nav (mobile) — 1 Primary Action */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigateSection('sites')}
              className="lg:hidden inline-flex items-center gap-2 text-base font-bold text-slate-900 whitespace-nowrap shrink-0"
            >
              <Server className="w-4 h-4 text-teal-700" />
              <span>مضيف</span>
            </button>
            <span className="hidden lg:inline text-sm font-medium text-slate-500 truncate">
              الاستضافة الخاصة / <span className="text-slate-900">{breadcrumbLabel}</span>
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigateSection('deploy')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>رفع مشروع جديد</span>
            </button>
          </div>
        </header>

        {/* Mobile compact nav */}
        <nav className="lg:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => navigateSection('sites')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              section === 'sites' && !selectedSite
                ? 'bg-slate-900 text-white'
                : 'text-slate-600'
            }`}
          >
            المشاريع ({sites.length})
          </button>
          <button
            type="button"
            onClick={() => navigateSection('deploy')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              section === 'deploy'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600'
            }`}
          >
            نشر جديد
          </button>
          <button
            type="button"
            onClick={() => navigateSection('domains')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              section === 'domains'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600'
            }`}
          >
            الدومينات
          </button>
          <button
            type="button"
            onClick={() => navigateSection('runtimes')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              section === 'runtimes'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600'
            }`}
          >
            بيئة التشغيل
          </button>
        </nav>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {selectedSite ? (
            <SiteDetailView
              site={selectedSite}
              health={health}
              onBack={() => setSelectedSiteId(null)}
              onSiteUpdated={handleSiteUpdated}
              onSiteDeleted={handleSiteDeleted}
            />
          ) : section === 'deploy' ? (
            <DeployView
              health={health}
              templates={templates}
              onDeployed={handleDeployed}
            />
          ) : section === 'domains' ? (
            <DomainsView
              sites={sites}
              health={health}
              onSelectSite={(id) => {
                setSelectedSiteId(id);
                setSection('sites');
              }}
            />
          ) : section === 'runtimes' ? (
            <RuntimesView health={health} />
          ) : (
            <SitesListView
              sites={sites}
              health={health}
              loading={loading}
              onSelectSite={(id) => setSelectedSiteId(id)}
              onGoDeploy={() => navigateSection('deploy')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
