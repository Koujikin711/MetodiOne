/** Заготовка модуля HoReCa (ресторан). Доступ по тарифной функции «horeca». */

export function HorecaPlaceholderPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10 pt-4">
      <h1 className="text-2xl font-semibold text-white">HoReCa</h1>
      <p className="text-sm text-slate-400">
        Производственный учёт, зал и кухня будут подключаться здесь. API: <code className="text-slate-300">GET /api/horeca/ping</code>
      </p>
    </div>
  );
}
