"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function FormLogin() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar(formData: FormData) {
    setCargando(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    });
    if (error) {
      setError("Correo o contraseña incorrectos");
      setCargando(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form action={entrar} className="flex flex-col gap-3">
      <input name="email" type="email" required autoComplete="email" placeholder="Correo"
        className="rounded-lg border border-neutral-300 px-3 py-3" />
      <input name="password" type="password" required autoComplete="current-password" placeholder="Contraseña"
        className="rounded-lg border border-neutral-300 px-3 py-3" />
      <button type="submit" disabled={cargando}
        className="rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-60">
        {cargando ? "Entrando…" : "Entrar"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
