"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ClipboardCheck, Home, Menu, ScanFace, Shirt, Users, X } from "lucide-react";

const MODULOS = [
  { href: "/admin", label: "Inicio", icon: Home },
  { href: "/admin/asistencia", label: "Asistencia", icon: ClipboardCheck },
  { href: "/admin/uniformes", label: "Uniformes y EPP", icon: Shirt },
  { href: "/admin/empleados", label: "Empleados", icon: Users },
  { href: "/admin/rostros", label: "Registrar rostros", icon: ScanFace },
];

export function MenuLateral({ pie }: { pie: React.ReactNode }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);

  const enlaces = (
    <nav className="flex flex-col gap-1">
      {MODULOS.map(({ href, label, icon: Icono }) => {
        const activo = href === "/admin" ? ruta === href : ruta.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setAbierto(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
              activo ? "bg-emerald-50 font-medium text-emerald-800" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            <Icono size={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const marca = (
    <div className="px-3">
      <p className="text-lg font-semibold">Xayac</p>
      <p className="text-xs text-neutral-500">Recursos Humanos</p>
    </div>
  );

  return (
    <>
      {/* Escritorio */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-neutral-200 bg-white p-3 py-5 md:flex">
        {marca}
        {enlaces}
        <div className="mt-auto">{pie}</div>
      </aside>

      {/* Celular */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <p className="font-semibold">Xayac · RH</p>
        <button onClick={() => setAbierto(true)} aria-label="Abrir menú">
          <Menu />
        </button>
      </header>
      {abierto && (
        <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setAbierto(false)}>
          <aside className="flex h-full w-72 flex-col gap-6 bg-white p-3 py-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              {marca}
              <button onClick={() => setAbierto(false)} aria-label="Cerrar menú">
                <X />
              </button>
            </div>
            {enlaces}
            <div className="mt-auto">{pie}</div>
          </aside>
        </div>
      )}
    </>
  );
}
