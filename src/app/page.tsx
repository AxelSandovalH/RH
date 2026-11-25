import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Página de enrutamiento: sólo redirige, puede bloquear en servidor.
export const instant = false;

// Envía a cada usuario a su módulo según su rol.
export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  // Un celular dado de alta como checador va directo al kiosko.
  const { data: dispositivo } = await supabase.rpc("mi_dispositivo");
  if (dispositivo) redirect("/kiosko");

  const { data: perfil } = await supabase
    .from("perfiles").select("rol, activo").eq("id", data.claims.sub).single();

  if (!perfil?.activo) redirect("/pendiente");
  redirect(perfil.rol === "rh" || perfil.rol === "admin" ? "/admin" : "/campo");
}
