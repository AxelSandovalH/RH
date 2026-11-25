import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { MenuLateral } from "@/components/menu-lateral";
import { requireRH } from "@/lib/auth";
import { cerrarSesion } from "@/app/acciones-sesion";

async function Usuario() {
  const perfil = await requireRH();
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{perfil.nombre}</p>
        <p className="text-xs capitalize text-neutral-500">{perfil.rol}</p>
      </div>
      <form action={cerrarSesion}>
        <button className="text-neutral-500 hover:text-neutral-900" aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut size={18} />
        </button>
      </form>
    </div>
  );
}

// El control de acceso corre junto al contenido: si no es RH, redirige.
async function Protegido({ children }: { children: React.ReactNode }) {
  await requireRH();
  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 md:flex">
      <MenuLateral pie={<Suspense fallback={null}><Usuario /></Suspense>} />
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <Suspense fallback={<p className="text-sm text-neutral-400">Cargando…</p>}>
          <Protegido>{children}</Protegido>
        </Suspense>
      </main>
    </div>
  );
}
