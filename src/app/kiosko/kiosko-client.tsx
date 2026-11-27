"use client";

import { useEffect, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { abrirCamara, cargarModelos, detectar } from "@/lib/rostros/face";
import { LectorR503, webSerialDisponible } from "@/lib/huella/r503";
import { BotonSalir } from "@/components/boton-salir";
import { ScreensaverReloj } from "@/components/screensaver-reloj";
import { checarHuella, checarRostro, registrarHuella, type PasoRegistro, type Resultado } from "./checadas";

type Dispositivo = { nombre: string; ubicacion: string; activo: boolean; requiere_gps: boolean };

type Estado =
  | { fase: "iniciando"; mensaje: string }
  | { fase: "bloqueado"; mensaje: string }
  | { fase: "esperando" }
  | { fase: "procesando" }
  | { fase: "registrando"; nombre: string; paso: PasoRegistro }
  | { fase: "resultado"; resultado: Resultado };

// Ajustes de la detección automática
const INTERVALO_MS = 350;
const CUADROS_ESTABLES = 2;      // detecciones seguidas antes de checar
const TAMANO_MINIMO = 0.22;      // la cara debe ocupar ~1/4 del ancho (persona cerca)
const MOSTRAR_RESULTADO_MS = 3500;
const REVISAR_REGISTROS_MS = 4000; // cada cuánto se pregunta si RH pidió registrar una huella
const SALVAPANTALLAS_MS = 60_000;   // sin actividad, se muestra el reloj / video
// Video del salvapantallas: colócalo en public/videos/. Si no existe, se muestra sólo el reloj.
const VIDEO_SALVAPANTALLAS = "/videos/salvapantallas-kiosko.mp4";

const TEXTO_PASO: Record<PasoRegistro, string> = {
  primera: "Pon el dedo en el lector",
  retirar: "Retira el dedo",
  segunda: "Pon el mismo dedo otra vez",
  guardando: "Guardando…",
};

export function KioskoClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const posicion = useRef<GeolocationPosition | null>(null);
  const lectorRef = useRef<LectorR503 | null>(null);
  const montado = useRef(true);
  const timerResultado = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "iniciando", mensaje: "Preparando checador…" });
  const [disp, setDisp] = useState<Dispositivo | null>(null);
  const [camara, setCamara] = useState(false);
  const [lector, setLector] = useState<"no-soportado" | "desconectado" | "conectado">("desconectado");
  const [reloj, setReloj] = useState<Date | null>(null);
  const [cercaMsg, setCercaMsg] = useState<string | null>(null);
  const [actividad, setActividad] = useState(0); // cambia al detectar una cara: quita el salvapantallas

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (timerResultado.current) clearTimeout(timerResultado.current);
      lectorRef.current?.cerrar();
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

  async function conectarLector(pedirPermiso: boolean) {
    try {
      const l = pedirPermiso ? await LectorR503.elegir() : await LectorR503.reconectar();
      if (!l) return;
      lectorRef.current = l;
      setLector("conectado");
      await l.luz("azul", "respirar");
    } catch (e) {
      console.warn("[kiosko] lector de huella:", e);
      if (pedirPermiso) setCercaMsg(e instanceof Error ? e.message : "No se pudo conectar el lector");
    }
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

  // Arranque: dispositivo habilitado, GPS (si aplica), lector de huella y cámara
  useEffect(() => {
    const supabase = createClient();
    let stream: MediaStream | null = null;
    let watchId: number | null = null;
    let cancelado = false;

    (async () => {
      const { data, error } = await supabase.rpc("mi_dispositivo");
      if (cancelado) return;
      if (error || !data) {
        setEstado({ fase: "bloqueado", mensaje: "Este equipo no está habilitado como checador. Pide a RH que lo dé de alta." });
        return;
      }
      const d = data as Dispositivo;
      setDisp(d);
      if (!d.activo) {
        setEstado({ fase: "bloqueado", mensaje: "Este checador está desactivado." });
        return;
      }

      if (d.requiere_gps !== false) {
        if (!navigator.geolocation) {
          setEstado({ fase: "bloqueado", mensaje: "Este equipo no tiene GPS disponible." });
          return;
        }
        watchId = navigator.geolocation.watchPosition(
          (p) => (posicion.current = p),
          () => setCercaMsg("Activa la ubicación del navegador para poder checar"),
          { enableHighAccuracy: true, maximumAge: 15_000 },
        );
      }

      // Lector de huella: se reconecta solo si ya se autorizó antes en este navegador
      const hayWebSerial = webSerialDisponible();
      if (!hayWebSerial) setLector("no-soportado");
      else await conectarLector(false);

      try {
        setEstado({ fase: "iniciando", mensaje: "Abriendo cámara…" });
        stream = await abrirCamara(videoRef.current!);
        setEstado({ fase: "iniciando", mensaje: "Cargando reconocimiento facial…" });
        await cargarModelos();
        if (!cancelado) setCamara(true);
      } catch {
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        if (!hayWebSerial) {
          setEstado({ fase: "bloqueado", mensaje: "No se pudo abrir la cámara. Da permiso de cámara a esta página." });
          return;
        }
        // Sin cámara pero con posibilidad de lector: el kiosko funciona sólo con huella
      }
      if (!cancelado) setEstado({ fase: "esperando" });
    })();

    return () => {
      cancelado = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const requiereGps = disp?.requiere_gps !== false;

  // Ciclo de rostro: cuando hay una cara estable y cercana, checa solo
  useEffect(() => {
    if (estado.fase !== "esperando" || !camara) return;
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
        if (det) setActividad((n) => n + 1);
        if (det && det.tamano < TAMANO_MINIMO) {
          setCercaMsg("Acércate un poco más");
          estables = 0;
        } else if (det) {
          setCercaMsg(null);
          estables++;
          if (estables >= CUADROS_ESTABLES) {
            // El proceso sigue aunque este efecto se limpie al cambiar de fase
            activo = false;
            setEstado({ fase: "procesando" });
            mostrarResultado(await checarRostro(supabase, video, det.descriptor, posicion.current, requiereGps));
            return;
          }
        } else {
          estables = 0;
          setCercaMsg(null);
        }
      }
      timer = setTimeout(ciclo, INTERVALO_MS);
    }

    ciclo();
    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }, [estado.fase, camara, requiereGps]);

  // Ciclo de huella: espera un dedo en el lector y checa
  useEffect(() => {
    const l = lectorRef.current;
    if (estado.fase !== "esperando" || lector !== "conectado" || !l) return;
    const supabase = createClient();
    let activo = true;

    (async () => {
      try {
        await l.esperarSinDedo(() => !activo); // que no cuente el dedo de la checada anterior
        if (!(await l.esperarDedo(() => !activo)) || !activo) return;
        activo = false;
        setEstado({ fase: "procesando" });
        const r = await checarHuella(supabase, l, camara ? videoRef.current : null, posicion.current, requiereGps);
        await l.luz(r.ok ? "azul" : "rojo", "parpadear");
        mostrarResultado(r);
      } catch (e) {
        console.warn("[kiosko] lector desconectado:", e);
        lectorRef.current = null;
        setLector("desconectado");
      }
    })();

    return () => {
      activo = false;
    };
  }, [estado.fase, lector, camara, requiereGps]);

  // Registro de huellas: RH lo pide desde el panel y este kiosko lo atiende
  useEffect(() => {
    const l = lectorRef.current;
    if (estado.fase !== "esperando" || lector !== "conectado" || !l) return;
    const supabase = createClient();
    let activo = true;

    const revisar = async () => {
      const { data } = await supabase.rpc("mi_enrolamiento_pendiente");
      if (!activo || !data) return;
      const solicitud = data as { id: string; nombre: string };
      activo = false;
      setEstado({ fase: "registrando", nombre: solicitud.nombre, paso: "primera" });
      const r = await registrarHuella(
        supabase, l, solicitud.id,
        (paso) => montado.current && setEstado({ fase: "registrando", nombre: solicitud.nombre, paso }),
        () => !montado.current,
      );
      mostrarResultado(
        r.ok
          ? { ok: true, tipo: "entrada", nombre: solicitud.nombre, hora: new Date().toISOString(), mensaje: "Huella registrada" }
          : { ok: false, error: `No se registró la huella de ${solicitud.nombre}: ${r.error}` },
      );
    };
    const t = setInterval(revisar, REVISAR_REGISTROS_MS);
    return () => {
      activo = false;
      clearInterval(t);
    };
  }, [estado.fase, lector]);

  const hora = reloj?.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }) ?? " ";
  const fecha = reloj?.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) ?? " ";
  const conHuella = lector === "conectado";
  const instruccion = camara && conHuella
    ? "Mira a la cámara o pon tu dedo en el lector"
    : conHuella ? "Pon tu dedo en el lector" : "Mira a la cámara para checar";

  return (
    <main className="fixed inset-0 flex flex-col bg-neutral-950 text-white">
      {(estado.fase === "esperando" || estado.fase === "resultado") && (
        <ScreensaverReloj
          marca="Xayac"
          leyenda={instruccion}
          zonaHoraria="America/Mexico_City"
          videoUrl={VIDEO_SALVAPANTALLAS}
          idleMs={SALVAPANTALLAS_MS}
          despertar={actividad}
          pausado={estado.fase !== "esperando"}
        />
      )}
      <header className="flex items-baseline justify-between px-5 pt-5">
        <div>
          <p className="text-4xl font-semibold tabular-nums">{hora}</p>
          <p className="text-sm capitalize text-neutral-400">{fecha}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {disp && <p className="text-right text-sm text-neutral-400">{disp.ubicacion}</p>}
          {conHuella && <p className="flex items-center gap-1 text-xs text-emerald-400"><Fingerprint size={14} /> Lector conectado</p>}
          <BotonSalir
            confirmar="¿Cerrar la sesión de este checador? Se necesitará volver a entrar con su correo y contraseña."
            className="text-xs text-neutral-600 hover:text-neutral-300"
          />
        </div>
      </header>

      <div className="relative mx-auto my-4 aspect-[3/4] w-full max-w-md flex-1 overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} playsInline muted className={`h-full w-full -scale-x-100 object-cover ${camara ? "" : "hidden"}`} />

        {/* Sin cámara: sólo huella */}
        {!camara && estado.fase === "esperando" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-neutral-400">
            <Fingerprint size={120} strokeWidth={1} className={conHuella ? "animate-pulse text-emerald-400" : ""} />
          </div>
        )}

        {/* Guía del rostro */}
        {camara && estado.fase === "esperando" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-3/5 w-3/5 rounded-[50%] border-4 border-white/50" />
          </div>
        )}

        {estado.fase === "registrando" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-purple-900/90 p-8 text-center">
            <Fingerprint size={96} strokeWidth={1.2} className="animate-pulse" />
            <p className="text-sm uppercase tracking-wide text-purple-200">Registro de huella</p>
            <p className="text-2xl font-semibold">{estado.nombre}</p>
            <p className="text-xl">{TEXTO_PASO[estado.paso]}</p>
          </div>
        )}

        {estado.fase === "resultado" && <PantallaResultado r={estado.resultado} />}

        {(estado.fase === "iniciando" || estado.fase === "bloqueado" || estado.fase === "procesando") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-8 text-center">
            <p className="text-lg">{estado.fase === "procesando" ? "Verificando…" : estado.mensaje}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 px-5 pb-8">
        <p className="text-center text-xl font-medium">
          {estado.fase === "esperando" ? (cercaMsg ?? instruccion) : " "}
        </p>
        {lector === "desconectado" && estado.fase === "esperando" && (
          <button
            onClick={() => conectarLector(true)}
            className="flex items-center gap-2 rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            <Fingerprint size={16} /> Conectar lector de huella
          </button>
        )}
      </div>
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
  if (r.mensaje) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-purple-700/90 p-8 text-center">
        <p className="text-5xl">✓</p>
        <p className="text-2xl font-semibold">{r.nombre}</p>
        <p className="text-xl">{r.mensaje}</p>
      </div>
    );
  }
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
