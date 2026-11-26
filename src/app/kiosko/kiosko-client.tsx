"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { abrirCamara, cargarModelos, capturarFoto, detectar } from "@/lib/rostros/face";

type Dispositivo = { nombre: string; ubicacion: string; activo: boolean };
type Resultado =
  | { ok: true; tipo: "entrada" | "salida"; nombre: string; duplicada?: boolean; hora: string }
  | { ok: false; error: string };

type Estado =
  | { fase: "iniciando"; mensaje: string }
  | { fase: "bloqueado"; mensaje: string }
  | { fase: "esperando" }
  | { fase: "procesando" }
  | { fase: "resultado"; resultado: Resultado };

// Ajustes de la detección automática
const INTERVALO_MS = 350;
const CUADROS_ESTABLES = 2;      // detecciones seguidas antes de checar
const TAMANO_MINIMO = 0.22;      // la cara debe ocupar ~1/4 del ancho (persona cerca)
const MOSTRAR_RESULTADO_MS = 3500;
const LIMITE_FOTO_MS = 8000;     // si la foto tarda más, se checa sin foto
const LIMITE_CHECADA_MS = 12000; // si el servidor no responde, se avisa y se reintenta

class TiempoAgotado extends Error {}

function conLimite<T>(promesa: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new TiempoAgotado()), ms);
    Promise.resolve(promesa).then(
      (v) => { clearTimeout(t); ok(v); },
      (e) => { clearTimeout(t); mal(e); },
    );
  });
}

type Supabase = ReturnType<typeof createClient>;

/** Foto + validación en el servidor, con límite de tiempo en cada paso. */
async function procesarChecada(
  supabase: Supabase,
  video: HTMLVideoElement,
  descriptor: number[],
  p: GeolocationPosition | null,
): Promise<Resultado> {
  if (!p) return { ok: false, error: "Esperando la ubicación del GPS… intenta de nuevo." };

  // Foto de evidencia: si falla o tarda, igual se intenta checar
  let fotoPath: string | null = null;
  try {
    fotoPath = await conLimite(
      (async () => {
        const { data: sesion } = await supabase.auth.getSession();
        const uid = sesion.session?.user.id;
        if (!uid) return null;
        const foto = await capturarFoto(video);
        const dia = new Date().toISOString().slice(0, 10);
        const ruta = `checadas/${uid}/${dia}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from("asistencia").upload(ruta, foto, { contentType: "image/jpeg" });
        if (error) console.warn("[kiosko] foto no subida:", error.message);
        return error ? null : ruta;
      })(),
      LIMITE_FOTO_MS,
    );
  } catch (e) {
    console.warn("[kiosko] foto omitida:", e instanceof TiempoAgotado ? "tiempo agotado" : e);
  }

  try {
    const { data, error } = await conLimite(
      supabase.rpc("registrar_checada", {
        p_descriptor: descriptor,
        p_lat: p.coords.latitude,
        p_lng: p.coords.longitude,
        p_precision: p.coords.accuracy,
        p_foto_path: fotoPath,
      }),
      LIMITE_CHECADA_MS,
    );
    if (error) {
      console.error("[kiosko] registrar_checada:", error);
      return { ok: false, error: "El servidor respondió con un error. Intenta de nuevo." };
    }
    return data as Resultado;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof TiempoAgotado
        ? "El servidor tardó demasiado. Revisa la conexión a internet e intenta de nuevo."
        : "Sin conexión con el servidor. Intenta de nuevo.",
    };
  }
}

export function KioskoClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const posicion = useRef<GeolocationPosition | null>(null);
  const montado = useRef(true);
  const timerResultado = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "iniciando", mensaje: "Preparando checador…" });
  const [disp, setDisp] = useState<Dispositivo | null>(null);
  const [reloj, setReloj] = useState<Date | null>(null);
  const [cercaMsg, setCercaMsg] = useState<string | null>(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (timerResultado.current) clearTimeout(timerResultado.current);
    };
  }, []);

  /** Muestra el resultado unos segundos y vuelve a esperar al siguiente. */
  function mostrarResultado(resultado: Resultado) {
    if (!montado.current) return;
    setEstado({ fase: "resultado", resultado });
    if (timerResultado.current) clearTimeout(timerResultado.current);
    timerResultado.current = setTimeout(() => {
      if (montado.current) setEstado({ fase: "esperando" });
    }, MOSTRAR_RESULTADO_MS);
  }

  // Reloj en pantalla
  useEffect(() => {
    const tick = () => setReloj(new Date());
    const primero = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(primero);
      clearInterval(t);
    };
  }, []);

  // Arranque: dispositivo habilitado, GPS, cámara y modelos
  useEffect(() => {
    const supabase = createClient();
    let stream: MediaStream | null = null;
    let watchId: number | null = null;
    let cancelado = false;

    (async () => {
      const { data, error } = await supabase.rpc("mi_dispositivo");
      if (cancelado) return;
      if (error || !data) {
        setEstado({ fase: "bloqueado", mensaje: "Este celular no está habilitado como checador. Pide a RH que lo dé de alta." });
        return;
      }
      const d = data as Dispositivo;
      setDisp(d);
      if (!d.activo) {
        setEstado({ fase: "bloqueado", mensaje: "Este checador está desactivado." });
        return;
      }

      if (!navigator.geolocation) {
        setEstado({ fase: "bloqueado", mensaje: "Este celular no tiene GPS disponible." });
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (p) => (posicion.current = p),
        () => setCercaMsg("Activa la ubicación del navegador para poder checar"),
        { enableHighAccuracy: true, maximumAge: 15_000 },
      );

      try {
        setEstado({ fase: "iniciando", mensaje: "Abriendo cámara…" });
        stream = await abrirCamara(videoRef.current!);
        setEstado({ fase: "iniciando", mensaje: "Cargando reconocimiento facial…" });
        await cargarModelos();
        if (!cancelado) setEstado({ fase: "esperando" });
      } catch {
        setEstado({ fase: "bloqueado", mensaje: "No se pudo abrir la cámara. Da permiso de cámara a esta página." });
      }
    })();

    return () => {
      cancelado = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Ciclo de detección: cuando hay una cara estable y cercana, checa solo
  useEffect(() => {
    if (estado.fase !== "esperando") return;
    const supabase = createClient();
    let estables = 0;
    let activo = true;
    let timer: ReturnType<typeof setTimeout>;

    async function ciclo() {
      if (!activo) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const det = await detectar(video).catch(() => null);
        if (!activo) return;
        if (det && det.tamano < TAMANO_MINIMO) {
          setCercaMsg("Acércate un poco más");
          estables = 0;
        } else if (det) {
          setCercaMsg(null);
          estables++;
          if (estables >= CUADROS_ESTABLES) {
            await checar(video, det.descriptor);
            return;
          }
        } else {
          estables = 0;
          setCercaMsg(null);
        }
      }
      timer = setTimeout(ciclo, INTERVALO_MS);
    }

    async function checar(video: HTMLVideoElement, descriptor: number[]) {
      // Al cambiar de fase este efecto se limpia (activo = false); el resto
      // del proceso NO depende de él, sino de montado/temporizador del componente.
      activo = false;
      setEstado({ fase: "procesando" });
      const resultado = await procesarChecada(supabase, video, descriptor, posicion.current);
      mostrarResultado(resultado);
    }

    ciclo();
    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }, [estado.fase]);

  const hora = reloj?.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }) ?? "\u00a0";
  const fecha = reloj?.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) ?? "\u00a0";

  return (
    <main className="fixed inset-0 flex flex-col bg-neutral-950 text-white">
      <header className="flex items-baseline justify-between px-5 pt-5">
        <div>
          <p className="text-4xl font-semibold tabular-nums">{hora}</p>
          <p className="text-sm capitalize text-neutral-400">{fecha}</p>
        </div>
        {disp && <p className="text-right text-sm text-neutral-400">{disp.ubicacion}</p>}
      </header>

      <div className="relative mx-auto my-4 aspect-[3/4] w-full max-w-md flex-1 overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />

        {/* Guía del rostro */}
        {estado.fase === "esperando" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-3/5 w-3/5 rounded-[50%] border-4 border-white/50" />
          </div>
        )}

        {estado.fase === "resultado" && <PantallaResultado r={estado.resultado} />}

        {(estado.fase === "iniciando" || estado.fase === "bloqueado" || estado.fase === "procesando") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-8 text-center">
            <p className="text-lg">
              {estado.fase === "procesando" ? "Verificando…" : estado.mensaje}
            </p>
          </div>
        )}
      </div>

      <p className="px-5 pb-8 text-center text-xl font-medium">
        {estado.fase === "esperando" ? (cercaMsg ?? "Mira a la cámara para checar") : " "}
      </p>
    </main>
  );
}

function PantallaResultado({ r }: { r: Resultado }) {
  if (!r.ok) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-600/90 p-8 text-center">
        <p className="text-5xl">✕</p>
        <p className="text-xl font-medium">{r.error}</p>
      </div>
    );
  }
  const hora = new Date(r.hora).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  const esEntrada = r.tipo === "entrada";
  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center ${esEntrada ? "bg-emerald-600/90" : "bg-sky-600/90"}`}>
      <p className="text-5xl">✓</p>
      <p className="text-2xl font-semibold">{r.nombre}</p>
      <p className="text-xl">
        {r.duplicada ? "Ya registrado" : esEntrada ? "Entrada" : "Salida"} · {hora}
      </p>
    </div>
  );
}
