"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { guardarEmpleado, type ResultadoAccion } from "./acciones";

const CAMPOS: [string, string, string?][] = [
  ["id_empleado", "Número de empleado *"],
  ["nombre", "Nombre completo *"],
  ["puesto", "Puesto"],
  ["servicio", "Servicio"],
  ["cliente", "Cliente / punto"],
  ["fecha_ingreso", "Fecha de ingreso", "date"],
];
const TALLAS: [string, string][] = [
  ["talla_camisa", "Camisa"],
  ["talla_polo", "Polo"],
  ["talla_pantalon", "Pantalón"],
  ["talla_calzado", "Calzado"],
  ["talla_chaleco", "Chaleco"],
  ["talla_casco", "Casco"],
];

export function FormEmpleado() {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, enviando] = useActionState<ResultadoAccion, FormData>(guardarEmpleado, null);

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
        <Plus size={16} /> Nuevo empleado
      </button>
    );
  }

  const input = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";
  return (
    <form action={accion} className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CAMPOS.map(([name, label, type]) => (
          <label key={name} className="text-sm">
            <span className="mb-1 block text-neutral-600">{label}</span>
            <input name={name} type={type ?? "text"} className={input} />
          </label>
        ))}
      </div>
      <p className="mb-2 mt-4 text-sm font-medium text-neutral-700">Tallas</p>
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        {TALLAS.map(([name, label]) => (
          <label key={name} className="text-sm">
            <span className="mb-1 block text-neutral-600">{label}</span>
            <input name={name} className={input} />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button disabled={enviando} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {enviando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="text-sm text-neutral-500">
          Cerrar
        </button>
        {estado && <p className={`text-sm ${estado.ok ? "text-emerald-700" : "text-red-600"}`}>{estado.mensaje}</p>}
      </div>
    </form>
  );
}
