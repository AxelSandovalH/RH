import { createClient } from "@/lib/supabase/server";
import { Etiqueta, Tarjeta, Titulo, Vacio, TZ, fmtFecha, fmtHora } from "@/components/ui";

const MOTIVOS: Record<string, string> = {
  NO_RECONOCIDO: "Rostro no reconocido",
  FUERA_DE_ZONA: "Fuera de la zona",
  GPS_IMPRECISO: "GPS impreciso",
  DISPOSITIVO_INACTIVO: "Celular no habilitado",
};

type Checada = {
  id: string;
  tipo: "entrada" | "salida";
  fecha: string;
  foto_path: string | null;
  similitud: number | null;
  distancia_m: number | null;
  empleados: { id_empleado: string; nombre: string } | null;
  ubicaciones: { nombre: string } | null;
};

export default async function AsistenciaPage({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  const { dia: diaParam } = await searchParams;
  const supabase = await createClient();

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(diaParam ?? "") ? diaParam! : hoy;
  // Rango del día en hora del centro de México (UTC-6, sin horario de verano)
  const desde = new Date(`${dia}T00:00:00-06:00`).toISOString();
  const hasta = new Date(new Date(desde).getTime() + 86_400_000).toISOString();

  const [checadasRes, rechazosRes, ubicacionesRes, dispositivosRes] = await Promise.all([
    supabase
      .from("checadas")
      .select("id, tipo, fecha, foto_path, similitud, distancia_m, empleados(id_empleado, nombre), ubicaciones(nombre)")
      .gte("fecha", desde)
      .lt("fecha", hasta)
      .order("fecha", { ascending: true }),
    supabase
      .from("checadas_rechazos")
      .select("id, fecha, motivo, detalle, foto_path")
      .gte("fecha", new Date(new Date(desde).getTime() - 2 * 86_400_000).toISOString())
      .lt("fecha", hasta)
      .order("fecha", { ascending: false })
      .limit(30),
    supabase.from("ubicaciones").select("id, nombre, lat, lng, radio_metros, activo").order("nombre"),
    supabase.from("dispositivos").select("id, nombre, activo, ubicaciones(nombre)").order("nombre"),
  ]);

  const checadas = (checadasRes.data ?? []) as unknown as Checada[];
  const rechazos = rechazosRes.data ?? [];

  // URLs firmadas (1 hora) para ver las fotos del bucket privado
  const rutas = [...checadas.map((c) => c.foto_path), ...rechazos.map((r) => r.foto_path)].filter(Boolean) as string[];
  const urls = new Map<string, string>();
  if (rutas.length) {
    const { data } = await supabase.storage.from("asistencia").createSignedUrls(rutas, 3600);
    data?.forEach((d) => d.path && d.signedUrl && urls.set(d.path, d.signedUrl));
  }

  // Resumen por persona: primera entrada y última salida del día
  const porPersona = new Map<string, { nombre: string; entrada?: string; salida?: string; ubicacion?: string }>();
  for (const c of checadas) {
    if (!c.empleados) continue;
    const p = porPersona.get(c.empleados.id_empleado) ?? { nombre: c.empleados.nombre, ubicacion: c.ubicaciones?.nombre };
    if (c.tipo === "entrada" && !p.entrada) p.entrada = c.fecha;
    if (c.tipo === "salida") p.salida = c.fecha;
    porPersona.set(c.empleados.id_empleado, p);
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Titulo descripcion="Checadas desde los celulares checadores">Asistencia</Titulo>
        <form className="flex gap-2">
          <input type="date" name="dia" defaultValue={dia} max={hoy} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
          <button className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm">Ver</button>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo={`Asistencia del día (${porPersona.size})`} className="lg:col-span-2">
          {porPersona.size ? (
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1 font-medium">Persona</th>
                  <th className="py-1 font-medium">Entrada</th>
                  <th className="py-1 font-medium">Salida</th>
                  <th className="py-1 font-medium">Ubicación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {[...porPersona.values()].map((p) => (
                  <tr key={p.nombre}>
                    <td className="py-2 font-medium">{p.nombre}</td>
                    <td className="py-2 tabular-nums">{p.entrada ? fmtHora(p.entrada) : "—"}</td>
                    <td className="py-2 tabular-nums">{p.salida ? fmtHora(p.salida) : <Etiqueta color="verde">En turno</Etiqueta>}</td>
                    <td className="py-2 text-neutral-500">{p.ubicacion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Vacio>Sin checadas este día</Vacio>
          )}
        </Tarjeta>

        <Tarjeta titulo="Checadores">
          {ubicacionesRes.data?.length ? (
            <ul className="space-y-3 text-sm">
              {ubicacionesRes.data.map((u) => {
                const celulares = (dispositivosRes.data ?? []).filter(
                  (d) => (d.ubicaciones as unknown as { nombre: string } | null)?.nombre === u.nombre,
                );
                return (
                  <li key={u.id}>
                    <p className="font-medium">
                      {u.nombre} {!u.activo && <Etiqueta color="rojo">Inactiva</Etiqueta>}
                    </p>
                    <p className="text-xs text-neutral-500">
                      Radio {u.radio_metros} m ·{" "}
                      <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${u.lat},${u.lng}`}>
                        ver mapa
                      </a>
                    </p>
                    <p className="text-xs text-neutral-500">
                      {celulares.length ? celulares.map((d) => d.nombre).join(", ") : "Sin celular checador"}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Vacio>Sin ubicaciones registradas</Vacio>
          )}
        </Tarjeta>
      </div>

      <Tarjeta titulo={`Registro de checadas (${checadas.length})`} className="mt-4">
        {checadas.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {checadas.map((c) => (
              <li key={c.id} className="overflow-hidden rounded-lg border border-neutral-200">
                {c.foto_path && urls.get(c.foto_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls.get(c.foto_path)} alt={`Foto de ${c.empleados?.nombre ?? "checada"}`} className="aspect-[4/3] w-full -scale-x-100 object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-neutral-100 text-xs text-neutral-400">Sin foto</div>
                )}
                <div className="p-2 text-xs">
                  <p className="truncate font-medium">{c.empleados?.nombre ?? "—"}</p>
                  <p className="flex items-center justify-between text-neutral-500">
                    <span>{fmtHora(c.fecha)}</span>
                    <Etiqueta color={c.tipo === "entrada" ? "verde" : "azul"}>{c.tipo === "entrada" ? "Entrada" : "Salida"}</Etiqueta>
                  </p>
                  {c.similitud != null && (
                    <p className="text-neutral-400" title="Distancia facial: menor es más parecido (límite 0.5)">
                      Coincidencia {Math.round((1 - c.similitud) * 100)}% · {c.distancia_m ?? "?"} m
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Vacio>Sin checadas este día</Vacio>
        )}
      </Tarjeta>

      <Tarjeta titulo="Intentos rechazados · 3 días hasta la fecha elegida" className="mt-4">
        {rechazos.length ? (
          <ul className="divide-y divide-neutral-100 text-sm">
            {rechazos.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                {r.foto_path && urls.get(r.foto_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls.get(r.foto_path)} alt="Foto del intento" className="h-10 w-10 -scale-x-100 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-neutral-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{MOTIVOS[r.motivo] ?? r.motivo}</p>
                  {r.detalle && <p className="truncate text-xs text-neutral-500">{r.detalle}</p>}
                </div>
                <span className="text-xs tabular-nums text-neutral-500">
                  {fmtFecha(r.fecha)} {fmtHora(r.fecha)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Vacio>Sin rechazos</Vacio>
        )}
      </Tarjeta>
    </>
  );
}
