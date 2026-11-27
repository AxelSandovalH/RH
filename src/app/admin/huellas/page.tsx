import { createClient } from "@/lib/supabase/server";
import { Etiqueta, Tarjeta, Titulo, Vacio, fmtFecha, fmtHora } from "@/components/ui";
import { FormRegistro } from "./form-registro";
import { cambiarGps, quitarHuella } from "./acciones";

const ESTADO: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: "Esperando el dedo", color: "ambar" },
  completado: { texto: "Registrada", color: "verde" },
  fallido: { texto: "Falló", color: "rojo" },
  cancelado: { texto: "Cancelada", color: "gris" },
};

type Huella = { id: number; slot: number; created_at: string; empleados: { nombre: string; id_empleado: string } | null };
type Dispositivo = { id: string; nombre: string; requiere_gps: boolean; ubicaciones: { nombre: string } | null; huellas: Huella[] };
type Solicitud = { id: string; estado: string; mensaje: string | null; created_at: string; empleados: { nombre: string } | null; dispositivos: { nombre: string } | null };

export default async function HuellasPage() {
  const supabase = await createClient();
  const [dispRes, empRes, solRes] = await Promise.all([
    supabase.from("dispositivos").select("id, nombre, requiere_gps, ubicaciones(nombre), huellas(id, slot, created_at, empleados(nombre, id_empleado))").order("nombre"),
    supabase.from("empleados").select("id_empleado, nombre").eq("estatus", "activo").order("nombre"),
    supabase.from("enrolamientos_huella").select("id, estado, mensaje, created_at, empleados(nombre), dispositivos(nombre)").order("created_at", { ascending: false }).limit(15),
  ]);
  const dispositivos = (dispRes.data ?? []) as unknown as Dispositivo[];
  const solicitudes = (solRes.data ?? []) as unknown as Solicitud[];

  return (
    <>
      <Titulo descripcion="La huella se guarda dentro del lector de cada checador; aquí sólo se ve a quién pertenece cada posición.">
        Huellas
      </Titulo>

      <Tarjeta titulo="Registrar una huella" className="mb-4">
        {dispositivos.length ? (
          <FormRegistro
            dispositivos={dispositivos.map((d) => ({ id: d.id, nombre: d.nombre }))}
            empleados={(empRes.data ?? []).map((e) => ({ id: e.id_empleado, nombre: e.nombre }))}
          />
        ) : (
          <Vacio>No hay checadores dados de alta.</Vacio>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          El checador debe tener el lector conectado. Si la persona va a checar en varios checadores, regístrala en cada uno.
        </p>
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-2">
        {dispositivos.map((d) => (
          <Tarjeta key={d.id} titulo={`${d.nombre} · ${d.ubicaciones?.nombre ?? "—"}`}>
            <form action={cambiarGps} className="mb-3 flex items-center justify-between gap-2 text-xs text-neutral-500">
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="requiere_gps" value={d.requiere_gps ? "0" : "1"} />
              <span>{d.requiere_gps ? "Valida ubicación por GPS (celular)" : "Kiosko fijo: no valida GPS"}</span>
              <button className="underline hover:text-neutral-900">{d.requiere_gps ? "Marcar como kiosko fijo" : "Volver a pedir GPS"}</button>
            </form>
            {d.huellas.length ? (
              <ul className="divide-y divide-neutral-100 text-sm">
                {[...d.huellas].sort((a, b) => a.slot - b.slot).map((h) => (
                  <li key={h.id} className="flex items-center justify-between py-2">
                    <span>
                      <span className="mr-2 tabular-nums text-neutral-400">#{h.slot}</span>
                      {h.empleados?.nombre ?? "—"}
                    </span>
                    <form action={quitarHuella}>
                      <input type="hidden" name="id" value={h.id} />
                      <button className="text-xs text-neutral-500 hover:text-red-600">Quitar</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio>Sin huellas registradas</Vacio>
            )}
          </Tarjeta>
        ))}
      </div>

      <Tarjeta titulo="Solicitudes recientes" className="mt-4">
        {solicitudes.length ? (
          <ul className="divide-y divide-neutral-100 text-sm">
            {solicitudes.map((s) => {
              const e = ESTADO[s.estado] ?? { texto: s.estado, color: "gris" };
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {s.empleados?.nombre ?? "—"} <span className="text-neutral-400">· {s.dispositivos?.nombre ?? "—"}</span>
                    {s.mensaje && s.estado === "fallido" && <span className="block text-xs text-red-600">{s.mensaje}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Etiqueta color={e.color}>{e.texto}</Etiqueta>
                    <span className="text-xs tabular-nums text-neutral-500">{fmtFecha(s.created_at)} {fmtHora(s.created_at)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Vacio>Sin solicitudes</Vacio>
        )}
      </Tarjeta>
    </>
  );
}
