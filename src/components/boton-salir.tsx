"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** Cierra la sesión y manda al login. Con `confirmar`, pregunta antes. */
export function BotonSalir({ confirmar, className = "", texto = "Cerrar sesión" }: { confirmar?: string; className?: string; texto?: string }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    if (confirmar && !window.confirm(confirmar)) return;
    setSaliendo(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button onClick={salir} disabled={saliendo} className={`flex items-center gap-1 disabled:opacity-50 ${className}`}>
      <LogOut size={14} /> {saliendo ? "Saliendo…" : texto}
    </button>
  );
}
