import { createClient } from "@/lib/supabase/server";
import { Etiqueta, Tarjeta, Titulo, Vacio, fmtFecha } from "@/components/ui";
import { AccionesSolicitud, FormMovimiento, FormPrenda } from "./formularios";

const ESTATUS: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: "Pendiente", color: "ambar" },
  requiere_aprobacion: { texto: "Excede límite", color: "rojo" },
  aprobada: { texto: "Aprobada", color: "azul" },
  surtida: { texto: "Surtida", color: "azul" },
  entregada: { texto: "Entregada", color: "verde" },
  rechazada: { texto: "Rechazada", color: "gris" },
  cancelada: { texto: "Cancelada", color: "gris" },
};

type Solicitud = {
  id: string;
  estatus: string;
  justificacion: string | null;
  fecha_solicitud: string;
  empleados: { nombre: string } | null;
  perfiles: { nombre: string } | null;
  solicitud_items: { sku: string; cantidad: number }[];
};

export default async function UniformesPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver = "abiertas" } = await searchParams;
  const supabase = await createClient();

  let consulta = supabase
    .from("solicitudes")
    .select("id, estatus, justificacion, fecha_solicitud, empleados(nombre), perfiles!solicitudes_supervisor_id_fkey(nombre), solicitud_items(sku, cantidad)")
    .order("fecha_solicitud", { ascending: false })
    .limit(100);
  if (ver === "abiertas") consulta = consulta.in("estatus", ["pendiente", "requiere_aprobacion", "aprobada", "surtida"]);

  const [solicitudesRes, inventarioRes] = await Promise.all([
    consulta,
    supabase.from("inventario").select("sku, prenda, talla, cantidad_disponible, stock_minimo").order("prenda").order("talla"),
  ]);
  const solicitudes = (solicitudesRes.data ?? []) as unknown as Solicitud[];
  const inventario = inventarioRes.data ?? [];

  return (
    <>
      <Titulo descripcion="Solicitudes de los supervisores e inventario por prenda y talla">Uniformes y EPP</Titulo>

      <Tarjeta className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Solicitudes</h2>
          <div className="flex gap-1 text-xs">
            {[["abiertas", "Por atender"], ["todas", "Todas"]].map(([v, t]) => (
              <a key={v} href={`?ver=${v}`} className={`rounded-full px-3 py-1 ${ver === v ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>{t}</a>
            ))}
          </div>
        </div>
        {solicitudes.length ? (
          <ul className="divide-y divide-neutral-100">
            {solicitudes.map((s) => {
              const e = ESTATUS[s.estatus] ?? { texto: s.estatus, color: "gris" };
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {s.empleados?.nombre ?? "—"} <Etiqueta color={e.color}>{e.texto}</Etiqueta>
                    </p>
                    <p className="text-neutral-600">{s.solicitud_items.map((i) => `${i.cantidad}× ${i.sku}`).join(", ")}</p>
                    <p className="text-xs text-neutral-400">
                      {fmtFecha(s.fecha_solicitud)} · pidió {s.perfiles?.nombre ?? "—"}
                    </p>
                    {s.justificacion && <p className="mt-1 text-xs text-red-700">Justificación: {s.justificacion}</p>}
                  </div>
                  <AccionesSolicitud id={s.id} estatus={s.estatus} />
                </li>
              );
            })}
          </ul>
        ) : (
          <Vacio>No hay solicitudes {ver === "abiertas" ? "por atender" : ""}</Vacio>
        )}
      </Tarjeta>

      <Tarjeta>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-700">Inventario</h2>
          <FormPrenda />
        </div>
        {inventario.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1 font-medium">SKU</th>
                  <th className="py-1 font-medium">Prenda</th>
                  <th className="py-1 font-medium">Talla</th>
                  <th className="py-1 text-right font-medium">Disponible</th>
                  <th className="py-1 text-right font-medium">Mínimo</th>
                  <th className="py-1 text-right font-medium">Entrada / ajuste</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {inventario.map((i) => (
                  <tr key={i.sku}>
                    <td className="py-2 text-neutral-500">{i.sku}</td>
                    <td className="py-2 capitalize">{i.prenda}</td>
                    <td className="py-2">{i.talla}</td>
                    <td className="py-2 text-right tabular-nums">
                      {i.cantidad_disponible <= i.stock_minimo ? (
                        <Etiqueta color="rojo">{i.cantidad_disponible}</Etiqueta>
                      ) : (
                        i.cantidad_disponible
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-neutral-500">{i.stock_minimo}</td>
                    <td className="py-2"><FormMovimiento sku={i.sku} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Vacio>Sin prendas. Agrega la primera arriba (por ejemplo: camisa, talla M).</Vacio>
        )}
      </Tarjeta>
    </>
  );
}
