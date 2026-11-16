import { CheckCircle2, MinusCircle } from 'lucide-react';
import type { HealthInfo } from '../types';

interface RuntimesViewProps {
  health: HealthInfo | null;
}

export function RuntimesView({ health }: RuntimesViewProps) {
  const caps = health?.capabilities;

  const runtimes = [
    {
      name: 'Node.js',
      role: 'تشغيل خوادم Express / API وبناء مشاريع React و Vite و Next.js',
      version: caps?.node || null,
    },
    {
      name: 'npm',
      role: 'تثبيت الحزم وتشغيل أوامر البناء التلقائية',
      version: caps?.npm || null,
    },
    {
      name: 'Python 3',
      role: 'تشغيل تطبيقات Flask / FastAPI / Python HTTP',
      version: caps?.python3 || null,
    },
    {
      name: 'Java (JDK / Maven)',
      role: 'ترجمة وتشغيل تطبيقات Java و Spring Boot وملفات JAR',
      version: caps?.java || caps?.mvn || null,
    },
    {
      name: 'PHP',
      role: 'تشغيل مواقع PHP و Laravel',
      version: caps?.php || null,
    },
    {
      name: 'Go',
      role: 'بناء وتشغيل خدمات الويب بلغة Go',
      version: caps?.go || null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          بيئات التشغيل والملكية الذاتية
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
          فحص حقيقي لمترجمات اللغات المتوفرة حالياً على هذا الخادم، مع إمكانية
          تشغيل المنصة بالكامل على سيرفرك الشخصي (VPS) لتشغيل كل اللغات بدون قيود.
        </p>
      </div>

      {health?.serverless && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 leading-relaxed">
          تعمل اللوحة حالياً في وضع{' '}
          <span className="font-semibold">Serverless (مثل Vercel)</span>: التخزين
          الداخلي في <span className="font-mono" dir="ltr">/tmp</span> مؤقت ولا
          يستمر عبر إعادة تشغيل الحاوية، ولا تتوفر بيئات تشغيل الخلفية الدائمة
          أو توجيه DNS المباشر على عنوان IP ثابت إلا عند تشغيل المنصة على سيرفرك
          الشخصي (VPS) عبر <span className="font-mono" dir="ltr">npm start</span>.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {runtimes.map((rt) => (
          <div
            key={rt.name}
            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <div className="text-sm font-semibold text-slate-900" dir="ltr">
                {rt.name}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{rt.role}</div>
            </div>

            <div className="shrink-0">
              {rt.version ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="font-mono" dir="ltr">
                    {rt.version}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <MinusCircle className="w-4 h-4 shrink-0" />
                  <span>غير مثبت في الحاوية الحالية</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          تشغيل الاستضافة بملكيتك الكاملة على سيرفر خاص (VPS)
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          هذه المنصة مملوكة لك بالكامل ولا تعتمد على أي مزود خارجي. عند نقل
          الكود إلى خادم Ubuntu/Linux الخاص بك، يمكنك تثبيت بيئات Java و PHP و
          Python وتشغيل الخادم بأمر واحد:
        </p>
        <pre
          dir="ltr"
          className="bg-slate-950 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"
        >{`# تثبيت بيئات اللغات الإضافية على خادمك (اختياري لـ Java / PHP / Go)
sudo apt update && sudo apt install -y openjdk-17-jdk maven php-cli golang

# بناء وتشغيل منصة الاستضافة الخاصة بك على المنفذ 3000 (أو خلف Nginx على منفذ 80/443)
npm install
npm run build
PORT=3000 npm start`}</pre>
      </div>
    </div>
  );
}
