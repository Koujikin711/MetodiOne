export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      className={["btn-secondary print-hide px-3 py-1.5 text-xs sm:text-sm", className].filter(Boolean).join(" ")}
      onClick={() => window.print()}
    >
      Печать
    </button>
  );
}
