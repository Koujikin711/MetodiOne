import { Link } from "react-router-dom";

type Props = {
  title?: string;
  message: string;
};

export function AccessDenied({ title = "Нет доступа", message }: Props) {
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-[var(--mo-border)] bg-white p-8 text-center">
      <h1 className="lux-heading text-xl">{title}</h1>
      <p className="text-sm mo-muted">{message}</p>
      <Link to="/app" className="btn-primary inline-flex">
        На главную
      </Link>
    </div>
  );
}
