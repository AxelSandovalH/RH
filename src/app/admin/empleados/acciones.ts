"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRH } from "@/lib/auth";

export type ResultadoAccion = { ok: boolean; mensaje: string } | null;

const texto = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export async function guardarEmpleado(_prev: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  await requireRH();
  const id = texto(form, "id_empleado");
  const nombre = texto(form, "nombre");
  if (!id || !nombre) return { ok: false, mensaje: "Número de empleado y nombre son obligatorios" };

  const supabase = await createClient();
  const { error } = await supabase.from("empleados").upsert({
    id_empleado: id,
    nombre,
    puesto: texto(form, "puesto"),
    servicio: texto(form, "servicio"),
    cliente: texto(form, "cliente"),
    fecha_ingreso: texto(form, "fecha_ingreso"),
    talla_camisa: texto(form, "talla_camisa"),
    talla_polo: texto(form, "talla_polo"),
    talla_pantalon: texto(form, "talla_pantalon"),
    talla_calzado: texto(form, "talla_calzado"),
    talla_chaleco: texto(form, "talla_chaleco"),
    talla_casco: texto(form, "talla_casco"),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath("/admin/empleados");
  return { ok: true, mensaje: `${nombre} guardado` };
}

export async function cambiarEstatus(form: FormData) {
  await requireRH();
  const id = String(form.get("id_empleado"));
  const estatus = form.get("estatus") === "baja" ? "baja" : "activo";
  const supabase = await createClient();
  await supabase.from("empleados").update({ estatus, updated_at: new Date().toISOString() }).eq("id_empleado", id);
  revalidatePath("/admin/empleados");
}
