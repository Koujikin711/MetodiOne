import {
  ServerUnavailableState,
  isServerUnavailableError,
} from "@/components/ServerUnavailableState";

type Props = {
  error: unknown;
  onRetry?: () => void;
  className?: string;
};

/** Ошибка запроса: для 503 — робот, иначе короткая красная строка. */
export function QueryErrorNotice({ error, onRetry, className }: Props) {
  const message = error instanceof Error ? error.message : String(error ?? "Ошибка загрузки");
  if (isServerUnavailableError(error)) {
    return (
      <div className={className}>
        <ServerUnavailableState message={message} onRetry={onRetry} />
      </div>
    );
  }
  return <p className={`text-sm text-[var(--mo-danger)] ${className ?? ""}`}>{message}</p>;
}
