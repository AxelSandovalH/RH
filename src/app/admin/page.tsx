import Link from "next/link";
import { ClipboardCheck, PackageX, Shirt, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Tarjeta, Titulo, Vacio, Etiqueta, fmtHora, inicioDeHoy } from "@/components/ui";

export default async function InicioPage() {
  const supabase = await createClient();
  const hoy = inicioDeHoy();

  const [empleados, checadasHoy, pendientes, inventario, recientes] = await Promise.all([
    supabase.from("empleados").select("*", { count: "exact", head: true }).eq("estatus", "activo"),
    supabase.from("checadas").select("id_empleado, tipo").gte("fecha", hoy),
    supabase.from("solicitudes").select("*", { count: "exact", head: true }).in("estatus", ["pendiente", "requiere_aprobacion"]),
    supabase.from("inventario").select("sku, cantidad_disponible, stock_minimo"),
    supabase
      .from("checadas")
      .select("id, tipo, fecha, empleados(nombre), ubicaciones(nombre)")
      .order("fecha", { ascending: false })
      .limit(8),
  ]);

  const presentes = new Set((checadasHoy.data ?? []).filter((c) => c.tipo === "entrada").map((c) => c.id_empleado)).size;
  const bajoMinimo = (inventario.data ?? []).filter((i) => i.cantidad_disponible <= i.stock_minimo).length;

  const indicadores = [
    { label: "Empleados activos", valor: empleados.count ?? 0, icon: Users, href: "/admin/empleados" },
    { label: "Presentes hoy", valor: presentes, icon: ClipboardCheck, href: "/admin/asistencia" },
    { label: "Solicitudes por atender", valor: pendientes.count ?? 0, icon: Shirt, href: "/admin/uniformes" },
    { label: "Prendas bajo mínimo", valor: bajoMinimo, icon: PackageX, href: "/admin/uniformes" },
  ];

  return (
    <>
      <Titulo descripcion="Resumen del día">Inicio</Titulo>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {indicadores.map(({ label, valor, icon: Icono, href }) => (
          <Link key={label} href={href} className="rounded-xl border border-neutral-200 bg-white p-4 hover:border-emerald-300">
            <Icono size={18} className="mb-2 text-emerald-700" />
            <p className="text-3xl font-semibold tabular-nums">{valor}</p>
            <p className="text-sm text-neutral-500">{label}</p>
          </Link>
        ))}
      </div>

      <Tarjeta titulo="Últimas checadas">
        {recientes.data?.length ? (
          <ul className="divide-y divide-neutral-100">
            {recientes.data.map((c) => {
              const emp = c.empleados as unknown as { nombre: string } | null;
              const ubi = c.ubicaciones as unknown as { nombre: string } | null;
              return (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {emp?.nombre ?? "—"} <span className="text-neutral-400">· {ubi?.nombre ?? "—"}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Etiqueta color={c.tipo === "entrada" ? "verde" : "azul"}>{c.tipo === "entrada" ? "Entrada" : "Salida"}</Etiqueta>
                    <span className="tabular-nums text-neutral-500">{fmtHora(c.fecha)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Vacio>Aún no hay checadas</Vacio>
        )}
      </Tarjeta>
    </>
  );
}
