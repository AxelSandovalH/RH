"use client";

import { useActionState } from "react";
import { pedirRegistro, type ResultadoAccion } from "./acciones";

type Opcion = { id: string; nombre: string };

export function FormRegistro({ dispositivos, empleados }: { dispositivos: Opcion[]; empleados: Opcion[] }) {
  const [estado, accion, enviando] = useActionState<ResultadoAccion, FormData>(pedirRegistro, null);
  const campo = "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
  return (
    <form action={accion} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <select name="dispositivo_id" className={campo} defaultValue="">
          <option value="" disabled>Checador…</option>
          {dispositivos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <select name="id_empleado" className={`${campo} min-w-0 flex-1`} defaultValue="">
          <option value="" disabled>Empleado…</option>
          {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre} ({e.id})</option>)}
        </select>
        <button disabled={enviando} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {enviando ? "Enviando…" : "Pedir registro de huella"}
        </button>
      </div>
      {estado && <p className={`text-sm ${estado.ok ? "text-emerald-700" : "text-red-600"}`}>{estado.mensaje}</p>}
    </form>
  );
}
