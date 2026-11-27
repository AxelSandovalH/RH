"use client";

/**
 * Salvapantallas con reloj para el kiosko. Se activa tras `idleMs` sin
 * actividad y se quita al primer toque, tecla o movimiento, o cuando cambia
 * `despertar` (el kiosko lo cambia al detectar una cara o un dedo).
 *
 * Con `videoUrl` muestra un video en loop con el reloj abajo; sin video
 * (o mientras carga), el reloj grande centrado sobre degradado.
 */
import { useEffect, useRef, useState } from "react";

type Props = {
  marca?: string;
  logo?: string;
  leyenda?: string;
  zonaHoraria?: string;
  locale?: string;
  videoUrl?: string | null;
  idleMs?: number;
  /** Forzar siempre visible (p. ej. una página que sólo es reloj). */
  siempre?: boolean;
  /** Cada cambio de este valor quita el salvapantallas y reinicia la espera. */
  despertar?: unknown;
  /** Mientras sea true no se activa (p. ej. el kiosko está atendiendo a alguien). */
  pausado?: boolean;
};

/* El tick de cada segundo sólo re-renderiza este texto, no la página entera. */
function Reloj({ className, zonaHoraria, locale }: { className?: string; zonaHoraria?: string; locale: string }) {
  const [hora, setHora] = useState("");
  useEffect(() => {
    const tick = () =>
      setHora(new Date().toLocaleTimeString(locale, { timeZone: zonaHoraria, hour: "numeric", minute: "2-digit", hour12: true }));
    const primero = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(primero);
      clearInterval(id);
    };
  }, [zonaHoraria, locale]);
  return <p className={className}>{hora}</p>;
}

function useFecha(zonaHoraria: string | undefined, locale: string) {
  const [f, setF] = useState("");
  useEffect(() => {
    const calc = () => setF(new Date().toLocaleDateString(locale, { timeZone: zonaHoraria, weekday: "long", day: "numeric", month: "long" }));
    const primero = setTimeout(calc, 0);
    const id = setInterval(calc, 60_000);
    return () => {
      clearTimeout(primero);
      clearInterval(id);
    };
  }, [zonaHoraria, locale]);
  return f;
}

export function ScreensaverReloj({
  marca, logo, leyenda, zonaHoraria, locale = "es-MX", videoUrl = null, idleMs = 60_000, siempre = false,
  despertar, pausado = false,
}: Props) {
  const [activo, setActivo] = useState(siempre);
  const [videoListo, setVideoListo] = useState(false);
  const [videoFallo, setVideoFallo] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fecha = useFecha(zonaHoraria, locale);

  useEffect(() => {
    if (siempre) return;
    const programar = () => {
      if (timer.current) clearTimeout(timer.current);
      if (!pausado) timer.current = setTimeout(() => setActivo(true), idleMs);
    };
    const reiniciar = () => {
      setActivo(false);
      programar();
    };
    const eventos = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
    eventos.forEach((e) => window.addEventListener(e, reiniciar, { passive: true }));
    // Al montar, al despertar o al pausar: quitarlo y volver a contar
    const inicial = setTimeout(reiniciar, 0);
    return () => {
      clearTimeout(inicial);
      eventos.forEach((e) => window.removeEventListener(e, reiniciar));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [idleMs, siempre, despertar, pausado]);

  // Si el video falló antes de que React escuchara el evento (o el formato no
  // es compatible, p. ej. HEVC), se queda el reloj sobre degradado.
  useEffect(() => {
    if (!activo || !videoUrl) return;
    const t = setTimeout(() => {
      if (videoRef.current?.error) setVideoFallo(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [activo, videoUrl]);

  if (!activo) return null;

  if (videoUrl && !videoFallo) {
    return (
      <div className="fixed inset-0 z-[9999] cursor-none select-none overflow-hidden bg-black text-white">
        <video
          ref={videoRef}
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          onPlaying={() => setVideoListo(true)}
          onError={() => setVideoFallo(true)}
          onStalled={(e) => {
            const v = e.currentTarget;
            v.load();
            void v.play().catch(() => {});
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${videoListo ? "opacity-100" : "opacity-0"}`}
        />
        {!videoListo && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
            <Reloj zonaHoraria={zonaHoraria} locale={locale} className="text-[6rem] font-extralight leading-none tracking-tight tabular-nums" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
        {(marca || logo) && (
          <div className="absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/70 to-transparent px-8 py-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo && <img src={logo} alt="" className="h-14 w-14 opacity-90" />}
            <div>
              {marca && <p className="text-xl font-semibold uppercase tracking-[0.3em] text-white/90 drop-shadow">{marca}</p>}
              <p className="text-sm capitalize text-white/50">{fecha}</p>
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-8 flex flex-col items-center gap-2 px-6 text-center">
          {/* Mientras el video carga, el reloj grande ya está al centro */}
          {videoListo && <Reloj zonaHoraria={zonaHoraria} locale={locale} className="text-6xl font-extralight tabular-nums drop-shadow-lg" />}
          {leyenda && <p className="text-sm uppercase tracking-[0.3em] text-white/60 drop-shadow">{leyenda}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex cursor-none select-none flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle at 30% 20%, #60a5fa 0, transparent 45%), radial-gradient(circle at 75% 80%, #818cf8 0, transparent 45%)" }}
      />
      {marca && <p className="mb-8 text-xl font-semibold uppercase tracking-[0.3em] text-white/40">{marca}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && <img src={logo} alt="" className="mb-8 h-14 w-14 animate-pulse opacity-40" />}
      <Reloj zonaHoraria={zonaHoraria} locale={locale} className="text-[7rem] font-extralight leading-none tracking-tight tabular-nums" />
      <p className="mt-4 text-xl capitalize tracking-wide text-white/40">{fecha}</p>
      {leyenda && <p className="mt-12 px-6 text-center text-sm uppercase tracking-[0.3em] text-white/25">{leyenda}</p>}
    </div>
  );
}
