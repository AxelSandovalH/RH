import { createClient } from "@/lib/supabase/server";
import { Etiqueta, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { FormEmpleado } from "./form-empleado";
import { cambiarEstatus } from "./acciones";

export default async function EmpleadosPage({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string }> }) {
  const { q = "", ver = "activo" } = await searchParams;
  const supabase = await createClient();

  let consulta = supabase
    .from("empleados")
    .select("id_empleado, nombre, puesto, servicio, cliente, estatus, talla_camisa, talla_pantalon, talla_calzado, rostros(count)")
    .order("nombre");
  if (ver !== "todos") consulta = consulta.eq("estatus", ver);
  // Se quitan caracteres que tienen significado en el filtro de PostgREST.
  const busqueda = q.replace(/[,()*%\\]/g, " ").trim();
  if (busqueda) consulta = consulta.or(`nombre.ilike.%${busqueda}%,id_empleado.ilike.%${busqueda}%,servicio.ilike.%${busqueda}%`);
  const { data: empleados } = await consulta;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Titulo descripcion="Catálogo de colaboradores, tallas y rostro registrado">Empleados</Titulo>
        <FormEmpleado />
      </div>

      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Buscar por nombre, número o servicio" className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <select name="ver" defaultValue={ver} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">
          <option value="activo">Activos</option>
          <option value="baja">Bajas</option>
          <option value="todos">Todos</option>
        </select>
        <button className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm">Buscar</button>
      </form>

      <Tarjeta className="overflow-x-auto p-0">
        {empleados?.length ? (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">No.</th>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Puesto / servicio</th>
                <th className="px-4 py-2 font-medium">Tallas (cam / pant / calz)</th>
                <th className="px-4 py-2 font-medium">Rostro</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {empleados.map((e) => {
                const muestras = (e.rostros as unknown as { count: number }[])?.[0]?.count ?? 0;
                return (
                  <tr key={e.id_empleado}>
                    <td className="px-4 py-2 tabular-nums text-neutral-500">{e.id_empleado}</td>
                    <td className="px-4 py-2 font-medium">
                      {e.nombre} {e.estatus === "baja" && <Etiqueta color="rojo">Baja</Etiqueta>}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{[e.puesto, e.servicio].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-2 text-neutral-600">
                      {[e.talla_camisa, e.talla_pantalon, e.talla_calzado].map((t) => t ?? "—").join(" / ")}
                    </td>
                    <td className="px-4 py-2">
                      {muestras ? <Etiqueta color="verde">Registrado</Etiqueta> : <Etiqueta color="ambar">Sin rostro</Etiqueta>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={cambiarEstatus}>
                        <input type="hidden" name="id_empleado" value={e.id_empleado} />
                        <input type="hidden" name="estatus" value={e.estatus === "activo" ? "baja" : "activo"} />
                        <button className="text-xs text-neutral-500 hover:text-neutral-900">
                          {e.estatus === "activo" ? "Dar de baja" : "Reactivar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Vacio>{q ? "Sin resultados" : "Aún no hay empleados. Agrega el primero con «Nuevo empleado»."}</Vacio>
        )}
      </Tarjeta>
    </>
  );
}
