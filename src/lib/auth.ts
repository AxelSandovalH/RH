import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Perfil = { id: string; nombre: string; email: string | null; rol: "supervisor" | "rh" | "admin" };

/** Perfil activo del usuario de la sesión; manda a /login o /pendiente si no aplica. */
export async function requirePerfil(): Promise<Perfil> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, nombre, email, rol, activo")
    .eq("id", data.claims.sub)
    .single();
  if (!perfil?.activo) redirect("/pendiente");
  return perfil as Perfil;
}

/** Sólo RH o admin; un supervisor es enviado a /campo. */
export async function requireRH(): Promise<Perfil> {
  const perfil = await requirePerfil();
  if (perfil.rol !== "rh" && perfil.rol !== "admin") redirect("/campo");
  return perfil;
}
