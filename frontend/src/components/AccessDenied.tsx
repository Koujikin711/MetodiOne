import { Link } from "react-router-dom";

type Props = {
  title?: string;
  message: string;
};

export function AccessDenied({ title = "Нет доступа", message }: Props) {
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-8 text-center">
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      <p className="text-sm text-slate-300">{message}</p>
      <Link
        to="/app"
        className="inline-flex rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/15 hover:bg-white/15"
      >
        На главную
      </Link>
    </div>
  );
}
