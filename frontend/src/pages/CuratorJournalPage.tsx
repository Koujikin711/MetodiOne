import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Navigate } from "react-router-dom";

import { DateField } from "@/components/DateField";
import { apiFetch, getStoredToken, resolveApiUrl } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";

type CuratorEntry = {
  id: number;
  entry_date: string;
  full_name: string;
  food_diary: string | null;
  has_photo: boolean;
  photo_url: string | null;
  complaint: string | null;
  created_by_name: string | null;
};

const ACCESS_ROLES = new Set(["curator", "owner", "super_owner", "admin", "administrator"]);

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatRuDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function CuratorJournalPage() {
  const role = decodeRoleFromToken(getStoredToken());
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [entryDate, setEntryDate] = useState(todayIso);
  const [fullName, setFullName] = useState("");
  const [foodDiary, setFoodDiary] = useState("");
  const [complaint, setComplaint] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [filterDate, setFilterDate] = useState("");
  const [search, setSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const canAccess = role != null && ACCESS_ROLES.has(role);

  const entriesQuery = useQuery({
    queryKey: ["curator-journal", filterDate, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterDate) {
        params.set("date_from", filterDate);
        params.set("date_to", filterDate);
      }
      if (search.trim()) params.set("q", search.trim());
      const qs = params.toString();
      return apiFetch<CuratorEntry[]>(`/api/curator-journal/entries${qs ? `?${qs}` : ""}`);
    },
    enabled: canAccess,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = fullName.trim();
      if (!name) throw new Error("Укажите ФИО");
      if (!entryDate) throw new Error("Укажите дату");

      if (photoFile) {
        const fd = new FormData();
        fd.append("entry_date", entryDate);
        fd.append("full_name", name);
        if (foodDiary.trim()) fd.append("food_diary", foodDiary.trim());
        if (complaint.trim()) fd.append("complaint", complaint.trim());
        fd.append("file", photoFile);
        return apiFetch<CuratorEntry>("/api/curator-journal/entries/with-photo", {
          method: "POST",
          body: fd,
        });
      }

      return apiFetch<CuratorEntry>("/api/curator-journal/entries", {
        method: "POST",
        body: JSON.stringify({
          entry_date: entryDate,
          full_name: name,
          food_diary: foodDiary.trim() || null,
          complaint: complaint.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Строка добавлена");
      setFullName("");
      setFoodDiary("");
      setComplaint("");
      setPhotoFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["curator-journal"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/curator-journal/entries/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Удалено");
      void queryClient.invalidateQueries({ queryKey: ["curator-journal"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);

  if (!canAccess) {
    return <Navigate to="/app" replace />;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  async function openPhoto(entry: CuratorEntry) {
    if (!entry.photo_url) return;
    try {
      const token = getStoredToken();
      const res = await fetch(resolveApiUrl(entry.photo_url), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error("Не удалось открыть фото");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка фото");
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-3 pb-24 pt-3 sm:px-4 sm:pb-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--mo-text)] sm:text-2xl">
          Дневник куратора
        </h1>
        <p className="text-sm mo-muted">
          Каждый день: дата, ФИО, дневник питания, фото и жалоба.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4"
      >
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Новая строка</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm mo-muted">
            Дата
            <div className="mt-1">
              <DateField value={entryDate} onChange={setEntryDate} />
            </div>
          </label>
          <label className="block text-sm mo-muted">
            ФИО
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Имя пациента"
              required
            />
          </label>
        </div>
        <label className="block text-sm mo-muted">
          Дневник питания
          <textarea
            value={foodDiary}
            onChange={(e) => setFoodDiary(e.target.value)}
            className="mo-input mt-1 min-h-[88px] w-full"
            placeholder="Что ел / пил за день…"
          />
        </label>
        <label className="block text-sm mo-muted">
          Жалоба
          <textarea
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            className="mo-input mt-1 min-h-[72px] w-full"
            placeholder="Жалоба пациента…"
          />
        </label>
        <label className="block text-sm mo-muted">
          Фото
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="mt-1 block w-full text-sm"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          />
          {photoFile ? (
            <span className="mt-1 block text-xs text-[var(--mo-text)]">{photoFile.name}</span>
          ) : null}
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="btn-primary w-full disabled:opacity-60 sm:w-auto sm:px-6"
        >
          {createMutation.isPending ? "Сохранение…" : "Добавить в таблицу"}
        </button>
      </form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm mo-muted">
            Фильтр по дате
            <div className="mt-1">
              <DateField value={filterDate} onChange={setFilterDate} allowClear />
            </div>
          </label>
          <label className="min-w-[12rem] flex-1 text-sm mo-muted">
            Поиск по ФИО
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="ФИО…"
            />
          </label>
          {filterDate || search ? (
            <button
              type="button"
              className="crm-pill-btn"
              onClick={() => {
                setFilterDate("");
                setSearch("");
              }}
            >
              Сбросить
            </button>
          ) : null}
        </div>

        {entriesQuery.isLoading ? <p className="text-sm lux-caption">Загрузка…</p> : null}
        {entriesQuery.isError ? (
          <p className="text-sm text-[var(--mo-danger)]">{(entriesQuery.error as Error).message}</p>
        ) : null}

        {/* Mobile cards */}
        <ul className="space-y-2 sm:hidden">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--mo-text)]">{row.full_name}</p>
                  <p className="text-xs mo-muted">{formatRuDate(row.entry_date)}</p>
                </div>
                <button
                  type="button"
                  className="text-xs text-[var(--mo-danger)]"
                  onClick={() => {
                    if (window.confirm("Удалить строку?")) deleteMutation.mutate(row.id);
                  }}
                >
                  Удалить
                </button>
              </div>
              {row.food_diary ? (
                <p className="mt-2 text-sm text-[var(--mo-text)]">
                  <span className="mo-muted">Питание: </span>
                  {row.food_diary}
                </p>
              ) : null}
              {row.complaint ? (
                <p className="mt-1 text-sm text-[var(--mo-text)]">
                  <span className="mo-muted">Жалоба: </span>
                  {row.complaint}
                </p>
              ) : null}
              {row.has_photo ? (
                <button
                  type="button"
                  className="mt-2 text-sm font-medium text-[var(--mo-accent)]"
                  onClick={() => void openPhoto(row)}
                >
                  Открыть фото
                </button>
              ) : (
                <p className="mt-2 text-xs mo-muted">Без фото</p>
              )}
            </li>
          ))}
          {!entriesQuery.isLoading && rows.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-[var(--mo-border)] px-4 py-8 text-center text-sm mo-muted">
              Пока нет записей
            </li>
          ) : null}
        </ul>

        {/* Desktop table */}
        <div className="hidden overflow-x-auto rounded-2xl border border-[var(--mo-border)] sm:block">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-[var(--mo-surface-elevated)] text-xs uppercase tracking-wide mo-muted">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Дата</th>
                <th className="px-3 py-2.5 font-semibold">ФИО</th>
                <th className="px-3 py-2.5 font-semibold">Дневник питания</th>
                <th className="px-3 py-2.5 font-semibold">Фото</th>
                <th className="px-3 py-2.5 font-semibold">Жалоба</th>
                <th className="px-3 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--mo-border)]">
              {rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-[var(--mo-accent-soft)]/40">
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {formatRuDate(row.entry_date)}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-[var(--mo-text)]">{row.full_name}</td>
                  <td className="max-w-[18rem] px-3 py-2.5 text-[var(--mo-text)]">
                    {row.food_diary || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.has_photo ? (
                      <button
                        type="button"
                        className="font-medium text-[var(--mo-accent)]"
                        onClick={() => void openPhoto(row)}
                      >
                        Фото
                      </button>
                    ) : (
                      <span className="mo-muted">—</span>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-3 py-2.5 text-[var(--mo-text)]">
                    {row.complaint || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      className="text-xs text-[var(--mo-danger)]"
                      onClick={() => {
                        if (window.confirm("Удалить строку?")) deleteMutation.mutate(row.id);
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {!entriesQuery.isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center mo-muted">
                    Пока нет записей
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => {
            setPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }}
          role="presentation"
        >
          <img
            src={previewUrl}
            alt="Фото дневника"
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
