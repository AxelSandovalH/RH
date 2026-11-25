"use client";

import { useActionState } from "react";
import { agregarPrenda, cambiarSolicitud, moverInventario, type ResultadoAccion } from "./acciones";

function Mensaje({ estado }: { estado: ResultadoAccion }) {
  if (!estado) return null;
  return <span className={`text-xs ${estado.ok ? "text-emerald-700" : "text-red-600"}`}>{estado.mensaje}</span>;
}

export function AccionesSolicitud({ id, estatus }: { id: string; estatus: string }) {
  const [estado, accion, enviando] = useActionState<ResultadoAccion, FormData>(cambiarSolicitud, null);
  const boton = "rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50";
  return (
    <form action={accion} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="id" value={id} />
      {(estatus === "pendiente" || estatus === "requiere_aprobacion") && (
        <>
          <button name="accion" value="aprobar" disabled={enviando} className={`${boton} bg-emerald-700 text-white`}>Aprobar</button>
          <button name="accion" value="rechazar" disabled={enviando} className={`${boton} border border-neutral-300`}>Rechazar</button>
        </>
      )}
      {(estatus === "aprobada" || estatus === "surtida") && (
        <button name="accion" value="entregar" disabled={enviando} className={`${boton} bg-sky-700 text-white`}>Marcar entregada</button>
      )}
      <Mensaje estado={estado} />
    </form>
  );
}

export function FormPrenda() {
  const [estado, accion, enviando] = useActionState<ResultadoAccion, FormData>(agregarPrenda, null);
  const input = "rounded-lg border border-neutral-300 px-3 py-2 text-sm";
  return (
    <form action={accion} className="flex flex-wrap items-center gap-2">
      <input name="prenda" placeholder="Prenda (ej. camisa)" className={`${input} w-40`} />
      <input name="talla" placeholder="Talla" className={`${input} w-24`} />
      <input name="stock_minimo" type="number" min={0} placeholder="Mínimo" className={`${input} w-24`} />
      <button disabled={enviando} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        Agregar prenda
      </button>
      <Mensaje estado={estado} />
    </form>
  );
}

export function FormMovimiento({ sku }: { sku: string }) {
  const [estado, accion, enviando] = useActionState<ResultadoAccion, FormData>(moverInventario, null);
  return (
    <form action={accion} className="flex items-center justify-end gap-2">
      <input type="hidden" name="sku" value={sku} />
      <input name="cantidad" type="number" placeholder="+/-" className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
      <button disabled={enviando} className="rounded-md border border-neutral-300 px-3 py-1 text-xs disabled:opacity-50">Aplicar</button>
      <Mensaje estado={estado} />
    </form>
  );
}
