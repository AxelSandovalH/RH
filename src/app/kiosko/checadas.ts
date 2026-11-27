"use client";

// Llamadas del kiosko al servidor (rostro y huella), con límite de tiempo.
import { createClient } from "@/lib/supabase/client";
import { capturarFoto } from "@/lib/rostros/face";
import { ErrorLector, type LectorR503 } from "@/lib/huella/r503";

export type Resultado =
  | { ok: true; tipo: "entrada" | "salida"; nombre: string; duplicada?: boolean; hora: string; mensaje?: string }
  | { ok: false; error: string };

type Supabase = ReturnType<typeof createClient>;

const LIMITE_FOTO_MS = 8000;     // si la foto tarda más, se checa sin foto
const LIMITE_CHECADA_MS = 12000; // si el servidor no responde, se avisa

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

function errorDeRed(e: unknown): Resultado {
  return {
    ok: false,
    error: e instanceof TiempoAgotado
      ? "El servidor tardó demasiado. Revisa la conexión a internet e intenta de nuevo."
      : "Sin conexión con el servidor. Intenta de nuevo.",
  };
}

/** Foto de evidencia: si falla o tarda, se checa sin foto. */
async function subirFoto(supabase: Supabase, video: HTMLVideoElement | null): Promise<string | null> {
  if (!video || video.readyState < 2) return null;
  try {
    return await conLimite(
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
    return null;
  }
}

function coords(p: GeolocationPosition | null) {
  return {
    p_lat: p?.coords.latitude ?? null,
    p_lng: p?.coords.longitude ?? null,
    p_precision: p?.coords.accuracy ?? null,
  };
}

async function llamar(supabase: Supabase, fn: string, args: Record<string, unknown>): Promise<Resultado> {
  try {
    const { data, error } = await conLimite(supabase.rpc(fn, args), LIMITE_CHECADA_MS);
    if (error) {
      console.error(`[kiosko] ${fn}:`, error);
      return { ok: false, error: "El servidor respondió con un error. Intenta de nuevo." };
    }
    return data as Resultado;
  } catch (e) {
    return errorDeRed(e);
  }
}

/** Checada por rostro. */
export async function checarRostro(
  supabase: Supabase, video: HTMLVideoElement, descriptor: number[], p: GeolocationPosition | null, requiereGps: boolean,
): Promise<Resultado> {
  if (requiereGps && !p) return { ok: false, error: "Esperando la ubicación del GPS… intenta de nuevo." };
  const fotoPath = await subirFoto(supabase, video);
  return llamar(supabase, "registrar_checada", { p_descriptor: descriptor, ...coords(p), p_foto_path: fotoPath });
}

/** Checada por huella: el dedo ya está capturado en el lector. */
export async function checarHuella(
  supabase: Supabase, lector: LectorR503, video: HTMLVideoElement | null, p: GeolocationPosition | null, requiereGps: boolean,
): Promise<Resultado> {
  if (requiereGps && !p) return { ok: false, error: "Esperando la ubicación del GPS… intenta de nuevo." };
  let encontrada: { slot: number } | null;
  try {
    await lector.procesar(1);
    encontrada = await lector.buscar();
  } catch (e) {
    return { ok: false, error: e instanceof ErrorLector ? e.message : "Error con el lector de huella" };
  }
  if (!encontrada) {
    await supabase.rpc("registrar_huella_no_reconocida").then(undefined, () => undefined);
    return { ok: false, error: "No reconocí tu huella. Intenta de nuevo con el dedo registrado." };
  }
  const fotoPath = await subirFoto(supabase, video);
  return llamar(supabase, "registrar_checada_huella", { p_slot: encontrada.slot, ...coords(p), p_foto_path: fotoPath });
}

export type PasoRegistro = "primera" | "retirar" | "segunda" | "guardando";

/**
 * Registra la huella pedida por RH: dos lecturas del mismo dedo, se guarda en
 * una posición libre del lector y se confirma al servidor.
 */
export async function registrarHuella(
  supabase: Supabase,
  lector: LectorR503,
  solicitudId: string,
  avisar: (paso: PasoRegistro) => void,
  cancelado: () => boolean,
): Promise<{ ok: true; slot: number } | { ok: false; error: string }> {
  const fallar = async (error: string) => {
    await supabase.rpc("terminar_enrolamiento_huella", { p_id: solicitudId, p_error: error }).then(undefined, () => undefined);
    await lector.luz("rojo", "parpadear");
    return { ok: false as const, error };
  };
  try {
    await lector.luz("morado", "respirar");
    avisar("primera");
    if (!(await lector.esperarDedo(cancelado))) return fallar("Cancelado");
    await lector.procesar(1);
    avisar("retirar");
    await lector.esperarSinDedo(cancelado);
    avisar("segunda");
    if (!(await lector.esperarDedo(cancelado))) return fallar("Cancelado");
    await lector.procesar(2);
    avisar("guardando");

    const { data: asignadas } = await supabase.rpc("mis_slots_huella");
    const slot = await lector.posicionLibre((asignadas as number[] | null) ?? []);
    await lector.guardar(slot);

    const { error } = await supabase.rpc("terminar_enrolamiento_huella", { p_id: solicitudId, p_slot: slot });
    if (error) {
      // El servidor no lo registró: se libera la posición para no dejar basura en el lector.
      await lector.borrar(slot).catch(() => undefined);
      return { ok: false, error: "No se pudo guardar en el servidor. Pide a RH que lo intente de nuevo." };
    }
    await lector.luz("azul", "parpadear");
    return { ok: true, slot };
  } catch (e) {
    return fallar(e instanceof ErrorLector ? e.message : "Error con el lector de huella");
  }
}
