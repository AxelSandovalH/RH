// Piezas visuales compartidas del ERP.

export function Titulo({ children, descripcion }: { children: React.ReactNode; descripcion?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {descripcion && <p className="mt-1 text-sm text-neutral-500">{descripcion}</p>}
    </div>
  );
}

export function Tarjeta({ titulo, children, className = "" }: { titulo?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-neutral-200 bg-white p-4 ${className}`}>
      {titulo && <h2 className="mb-3 text-sm font-semibold text-neutral-700">{titulo}</h2>}
      {children}
    </section>
  );
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-400">{children}</p>;
}

const COLORES: Record<string, string> = {
  verde: "bg-emerald-50 text-emerald-700",
  azul: "bg-sky-50 text-sky-700",
  ambar: "bg-amber-50 text-amber-700",
  rojo: "bg-red-50 text-red-700",
  gris: "bg-neutral-100 text-neutral-600",
};

export function Etiqueta({ color = "gris", children }: { color?: keyof typeof COLORES | string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLORES[color] ?? COLORES.gris}`}>{children}</span>;
}

export const TZ = "America/Mexico_City";

export function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-MX", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

export function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { timeZone: TZ, day: "numeric", month: "short" });
}

/** Inicio del día de hoy en la zona de operación, como ISO. */
export function inicioDeHoy(): string {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  return new Date(`${hoy}T00:00:00-06:00`).toISOString();
}
