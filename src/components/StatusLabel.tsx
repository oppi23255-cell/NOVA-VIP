import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import type { SiteStatus } from '../types';

interface StatusLabelProps {
  status: SiteStatus;
}

export function StatusLabel({ status }: StatusLabelProps) {
  switch (status) {
    case 'live':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>يعمل الآن</span>
        </span>
      );
    case 'building':
    case 'uploading':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          <span>جاري البناء</span>
        </span>
      );
    case 'runtime_missing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>يتطلب بيئة تشغيل</span>
        </span>
      );
    case 'stopped':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 whitespace-nowrap shrink-0">
          <PauseCircle className="w-3.5 h-3.5 shrink-0" />
          <span>متوقف</span>
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 whitespace-nowrap shrink-0">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          <span>خطأ تشغيل</span>
        </span>
      );
  }
}
