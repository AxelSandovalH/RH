"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRH } from "@/lib/auth";

export type ResultadoAccion = { ok: boolean; mensaje: string } | null;

function listo(mensaje: string): ResultadoAccion {
  revalidatePath("/admin/uniformes");
  revalidatePath("/admin");
  return { ok: true, mensaje };
}

export async function cambiarSolicitud(_prev: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const perfil = await requireRH();
  const id = String(form.get("id"));
  const accion = String(form.get("accion"));
  const supabase = await createClient();

  if (accion === "entregar") {
    const { error } = await supabase.rpc("entregar_solicitud", { p_solicitud: id });
    return error ? { ok: false, mensaje: error.message } : listo("Entregada; inventario descontado");
  }

  const cambios =
    accion === "aprobar" ? { estatus: "aprobada", aprobada_por: perfil.id }
    : accion === "rechazar" ? { estatus: "rechazada", motivo_rechazo: String(form.get("motivo") ?? "") || null }
    : null;
  if (!cambios) return { ok: false, mensaje: "Acción no válida" };

  const { error } = await supabase
    .from("solicitudes")
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("estatus", ["pendiente", "requiere_aprobacion"]);
  return error ? { ok: false, mensaje: error.message } : listo(accion === "aprobar" ? "Aprobada" : "Rechazada");
}

export async function agregarPrenda(_prev: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  await requireRH();
  const prenda = String(form.get("prenda") ?? "").trim().toLowerCase();
  const talla = String(form.get("talla") ?? "").trim().toUpperCase();
  const minimo = Number(form.get("stock_minimo") ?? 0) || 0;
  if (!prenda || !talla) return { ok: false, mensaje: "Prenda y talla son obligatorias" };

  const sku = `${prenda}-${talla}`.replace(/\s+/g, "-").toUpperCase();
  const supabase = await createClient();
  const { error } = await supabase.from("inventario").insert({ sku, prenda, talla, stock_minimo: minimo, cantidad_disponible: 0 });
  if (error) return { ok: false, mensaje: error.code === "23505" ? "Esa prenda y talla ya existen" : error.message };
  return listo(`${sku} agregado`);
}

export async function moverInventario(_prev: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  await requireRH();
  const sku = String(form.get("sku"));
  const cantidad = Math.trunc(Number(form.get("cantidad")));
  if (!cantidad) return { ok: false, mensaje: "Escribe una cantidad (negativa para ajuste a la baja)" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("registrar_movimiento_inventario", {
    p_sku: sku,
    p_cantidad: cantidad,
    p_nota: String(form.get("nota") ?? "") || null,
  });
  return error ? { ok: false, mensaje: error.message } : listo(`${sku}: ahora hay ${data}`);
}
