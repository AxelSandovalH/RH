"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRH } from "@/lib/auth";

export type ResultadoAccion = { ok: boolean; mensaje: string } | null;

export async function pedirRegistro(_prev: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  await requireRH();
  const dispositivo = String(form.get("dispositivo_id") ?? "");
  const empleado = String(form.get("id_empleado") ?? "");
  if (!dispositivo || !empleado) return { ok: false, mensaje: "Elige el checador y el empleado" };

  const supabase = await createClient();
  // Sólo una solicitud pendiente por checador: las anteriores se cancelan.
  await supabase.from("enrolamientos_huella").update({ estado: "cancelado", updated_at: new Date().toISOString() })
    .eq("dispositivo_id", dispositivo).eq("estado", "pendiente");
  const { error } = await supabase.from("enrolamientos_huella").insert({ dispositivo_id: dispositivo, id_empleado: empleado });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath("/admin/huellas");
  return { ok: true, mensaje: "Listo. En el checador aparecerá el aviso: la persona debe poner el dedo dos veces (tienes 10 minutos)." };
}

export async function quitarHuella(form: FormData) {
  await requireRH();
  const supabase = await createClient();
  await supabase.from("huellas").delete().eq("id", Number(form.get("id")));
  revalidatePath("/admin/huellas");
}

export async function cambiarGps(form: FormData) {
  await requireRH();
  const supabase = await createClient();
  await supabase.from("dispositivos").update({ requiere_gps: form.get("requiere_gps") === "1" }).eq("id", String(form.get("id")));
  revalidatePath("/admin/huellas");
}
