import { useEffect, useId, useRef, useState } from "react";

type Props = {
  src: string;
  fileName?: string | null;
  className?: string;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ChatMediaVideo({ src, fileName, className = "" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setSpeedOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const onSeek = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = value;
    setCurrent(value);
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = (fileName || "video").trim() || "video";
    a.rel = "noreferrer";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMenuOpen(false);
    setSpeedOpen(false);
  };

  return (
    <div className={["chat-video", className].filter(Boolean).join(" ")}>
      <video
        ref={videoRef}
        src={src}
        className="chat-video__media"
        preload="metadata"
        playsInline
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(videoRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
        onEnded={() => setPlaying(false)}
      />

      <div className="chat-video__bar">
        <button
          type="button"
          className="chat-video__btn"
          onClick={togglePlay}
          aria-label={playing ? "Пауза" : "Смотреть"}
        >
          {playing ? (
            <span className="chat-video__icon-pause" aria-hidden />
          ) : (
            <span className="chat-video__icon-play" aria-hidden />
          )}
        </button>

        <span className="chat-video__time tabular-nums">
          {formatTime(current)} / {formatTime(duration)}
        </span>

        <input
          type="range"
          className="chat-video__seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Позиция"
        />

        <div className="chat-video__menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="chat-video__btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            title="Ещё"
            onClick={() => {
              setMenuOpen((v) => !v);
              setSpeedOpen(false);
            }}
          >
            <span className="chat-video__icon-more" aria-hidden />
          </button>

          {menuOpen ? (
            <div id={menuId} role="menu" className="chat-video__menu">
              {!speedOpen ? (
                <>
                  <button type="button" role="menuitem" className="chat-video__menu-item" onClick={download}>
                    <svg className="chat-video__menu-svg" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Скачать
                  </button>
                  <div className="chat-video__menu-sep" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="chat-video__menu-item"
                    onClick={() => setSpeedOpen(true)}
                  >
                    <svg className="chat-video__menu-svg" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2" />
                      <path d="M10 9.5v5l4.5-2.5L10 9.5z" fill="currentColor" />
                    </svg>
                    Скорость воспроизведения
                    <span className="chat-video__menu-meta">{rate === 1 ? "Обычная" : `${rate}×`}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="chat-video__menu-item chat-video__menu-item--back"
                    onClick={() => setSpeedOpen(false)}
                  >
                    ← Назад
                  </button>
                  <div className="chat-video__menu-sep" role="separator" />
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={rate === s}
                      className={[
                        "chat-video__menu-item",
                        rate === s ? "is-active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        setRate(s);
                        setSpeedOpen(false);
                        setMenuOpen(false);
                      }}
                    >
                      {s === 1 ? "Обычная" : `${s}×`}
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
