"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { abrirCamara, cargarModelos, capturarFoto, detectar } from "@/lib/rostros/face";

type Empleado = { id_empleado: string; nombre: string; muestras: number };

export function RegistroRostros() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [filtro, setFiltro] = useState("");
  const [elegido, setElegido] = useState<Empleado | null>(null);
  const [listo, setListo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function leerEmpleados(): Promise<Empleado[]> {
    const supabase = createClient();
    const { data } = await supabase
      .from("empleados")
      .select("id_empleado, nombre, rostros(count)")
      .eq("estatus", "activo")
      .order("nombre");
    return (data ?? []).map((e) => ({
      id_empleado: e.id_empleado,
      nombre: e.nombre,
      muestras: (e.rostros as unknown as { count: number }[])?.[0]?.count ?? 0,
    }));
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      setEmpleados(await leerEmpleados());
      try {
        stream = await abrirCamara(videoRef.current!);
        await cargarModelos();
        setListo(true);
      } catch {
        setMensaje("No se pudo abrir la cámara");
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  async function capturar() {
    if (!elegido || !videoRef.current) return;
    setOcupado(true);
    setMensaje(null);
    const video = videoRef.current;
    const det = await detectar(video);
    if (!det) {
      setMensaje("No se detectó exactamente una cara. Que mire de frente, con buena luz.");
      setOcupado(false);
      return;
    }
    const supabase = createClient();
    const foto = await capturarFoto(video);
    const ruta = `rostros/${elegido.id_empleado}/${crypto.randomUUID()}.jpg`;
    const subida = await supabase.storage.from("asistencia").upload(ruta, foto, { contentType: "image/jpeg" });
    const { error } = await supabase.from("rostros").insert({
      id_empleado: elegido.id_empleado,
      descriptor: det.descriptor,
      foto_path: subida.error ? null : ruta,
    });
    setOcupado(false);
    if (error) {
      setMensaje(`Error al guardar: ${error.message}`);
      return;
    }
    const muestras = elegido.muestras + 1;
    setElegido({ ...elegido, muestras });
    setEmpleados((l) => l.map((e) => (e.id_empleado === elegido.id_empleado ? { ...e, muestras } : e)));
    setMensaje(`Muestra ${muestras} guardada para ${elegido.nombre}`);
  }

  const visibles = empleados.filter((e) =>
    `${e.nombre} ${e.id_empleado}`.toLowerCase().includes(filtro.toLowerCase()),
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por nombre o número"
          className="rounded-lg border border-neutral-300 px-3 py-2"
        />
        <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border border-neutral-200">
          {visibles.map((e) => (
            <li key={e.id_empleado}>
              <button
                onClick={() => setElegido(e)}
                className={`flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                  elegido?.id_empleado === e.id_empleado ? "bg-neutral-100 font-medium" : ""
                }`}
              >
                <span>{e.nombre}</span>
                <span className={e.muestras ? "text-emerald-600" : "text-neutral-400"}>
                  {e.muestras ? `${e.muestras} muestra${e.muestras > 1 ? "s" : ""}` : "sin rostro"}
                </span>
              </button>
            </li>
          ))}
          {visibles.length === 0 && <li className="px-3 py-2 text-sm text-neutral-400">Sin empleados</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <div className="aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        </div>
        <button
          onClick={capturar}
          disabled={!listo || !elegido || ocupado}
          className="rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {!listo ? "Cargando cámara…" : ocupado ? "Guardando…" : elegido ? `Capturar rostro de ${elegido.nombre}` : "Elige un empleado"}
        </button>
        {mensaje && <p className="text-sm text-neutral-600">{mensaje}</p>}
      </div>
    </div>
  );
}
