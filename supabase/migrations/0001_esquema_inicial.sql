-- Sistema de Control de Uniformes - Consorcio SEED
-- Esquema inicial para Supabase (Postgres).
-- Nota: sustituye la "Bitácora Activa + Histórico" del spec original por una sola
-- tabla de solicitudes indexada; la separación sólo existía por límites de Google Sheets.

-- ============ Perfiles y roles ============
create type rol_usuario as enum ('supervisor', 'rh', 'admin');

create table perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol rol_usuario not null default 'supervisor',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function es_rh() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol in ('rh','admin') and activo);
$$;

-- ============ Catálogo de empleados ============
create type estatus_empleado as enum ('activo', 'baja');

create table empleados (
  id_empleado text primary key,
  nombre text not null,
  puesto text,
  servicio text,
  cliente text,
  punto_asignado text,
  fecha_ingreso date,
  talla_camisa text,
  talla_polo text,
  talla_pantalon text,
  talla_calzado text,
  talla_chaleco text,
  talla_casco text,
  estatus estatus_empleado not null default 'activo',
  updated_at timestamptz not null default now()
);
create index empleados_busqueda_idx on empleados
  using gin (to_tsvector('spanish', coalesce(nombre,'') || ' ' || id_empleado || ' ' || coalesce(servicio,'')));

-- ============ Inventario por SKU (prenda + talla) ============
create table inventario (
  sku text primary key,
  prenda text not null,          -- camisa, polo, pantalon, calzado, chaleco, casco...
  talla text not null,
  cantidad_disponible integer not null default 0 check (cantidad_disponible >= 0),
  stock_minimo integer not null default 0,
  ubicacion text,
  unique (prenda, talla)
);

-- ============ Solicitudes ============
create type estatus_solicitud as enum
  ('pendiente', 'requiere_aprobacion', 'aprobada', 'rechazada', 'surtida', 'entregada', 'cancelada');

create table solicitudes (
  id uuid primary key default gen_random_uuid(),
  id_empleado text not null references empleados(id_empleado),
  supervisor_id uuid not null references perfiles(id) default auth.uid(),
  estatus estatus_solicitud not null default 'pendiente',
  excede_limite boolean not null default false,
  justificacion text,
  aprobada_por uuid references perfiles(id),
  motivo_rechazo text,
  firma_url text,
  acuse_url text,
  fecha_solicitud timestamptz not null default now(),
  fecha_entrega timestamptz,
  updated_at timestamptz not null default now(),
  constraint justificacion_si_excede check (not excede_limite or coalesce(trim(justificacion),'') <> '')
);
create index solicitudes_empleado_entrega_idx on solicitudes (id_empleado, fecha_entrega) where estatus = 'entregada';
create index solicitudes_estatus_idx on solicitudes (estatus, fecha_solicitud desc);

create table solicitud_items (
  id bigint generated always as identity primary key,
  solicitud_id uuid not null references solicitudes(id) on delete cascade,
  sku text not null references inventario(sku),
  cantidad integer not null check (cantidad > 0)
);

-- ============ Movimientos de inventario (kardex / auditoría) ============
create type tipo_movimiento as enum ('entrada', 'salida', 'ajuste');

create table movimientos_inventario (
  id bigint generated always as identity primary key,
  sku text not null references inventario(sku),
  tipo tipo_movimiento not null,
  cantidad integer not null,     -- positiva = suma, negativa = resta
  solicitud_id uuid references solicitudes(id),
  usuario_id uuid references perfiles(id) default auth.uid(),
  nota text,
  created_at timestamptz not null default now()
);

-- ============ Regla de 3 prendas (ventana móvil de 12 meses) ============
-- PENDIENTE DE CONFIRMAR: cuenta piezas entregadas. Si se decide contar solicitudes,
-- cambiar sum(i.cantidad) por count(distinct s.id).
create or replace function consumo_anual(p_empleado text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.cantidad), 0)::int
  from solicitudes s join solicitud_items i on i.solicitud_id = s.id
  where s.id_empleado = p_empleado
    and s.estatus = 'entregada'
    and s.fecha_entrega >= now() - interval '12 months';
$$;

-- Crea una solicitud aplicando la regla de límite anual.
-- p_items: [{"sku": "...", "cantidad": 1}, ...]
create or replace function crear_solicitud(p_empleado text, p_items jsonb, p_justificacion text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_nuevas int;
  v_excede boolean;
begin
  if not exists (select 1 from perfiles where id = auth.uid() and activo) then
    raise exception 'Usuario no autorizado';
  end if;
  if not exists (select 1 from empleados where id_empleado = p_empleado and estatus = 'activo') then
    raise exception 'Empleado inexistente o dado de baja';
  end if;

  select coalesce(sum((x->>'cantidad')::int), 0) into v_nuevas from jsonb_array_elements(p_items) x;
  if v_nuevas <= 0 then raise exception 'La solicitud no tiene prendas'; end if;

  v_excede := consumo_anual(p_empleado) + v_nuevas > 3;
  if v_excede and coalesce(trim(p_justificacion), '') = '' then
    raise exception 'LIMITE_ANUAL: se requiere justificación operativa';
  end if;

  insert into solicitudes (id_empleado, supervisor_id, estatus, excede_limite, justificacion)
  values (p_empleado, auth.uid(),
          case when v_excede then 'requiere_aprobacion' else 'pendiente' end::estatus_solicitud,
          v_excede, p_justificacion)
  returning id into v_id;

  insert into solicitud_items (solicitud_id, sku, cantidad)
  select v_id, x->>'sku', (x->>'cantidad')::int from jsonb_array_elements(p_items) x;

  return v_id;
end;
$$;

-- Marca como entregada y descuenta stock de forma atómica.
-- El UPDATE con "cantidad_disponible >= n" + bloqueo de fila evita race conditions
-- (reemplaza a LockService del diseño original).
create or replace function entregar_solicitud(p_solicitud uuid, p_firma_url text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not es_rh() then raise exception 'Sólo RH puede entregar'; end if;

  perform 1 from solicitudes where id = p_solicitud and estatus in ('aprobada', 'surtida') for update;
  if not found then raise exception 'La solicitud no está aprobada o no existe'; end if;

  for r in select sku, sum(cantidad)::int as cantidad from solicitud_items
           where solicitud_id = p_solicitud group by sku order by sku loop
    update inventario set cantidad_disponible = cantidad_disponible - r.cantidad
    where sku = r.sku and cantidad_disponible >= r.cantidad;
    if not found then raise exception 'Stock insuficiente para %', r.sku; end if;

    insert into movimientos_inventario (sku, tipo, cantidad, solicitud_id, nota)
    values (r.sku, 'salida', -r.cantidad, p_solicitud, 'Entrega de solicitud');
  end loop;

  update solicitudes set estatus = 'entregada', fecha_entrega = now(),
         firma_url = coalesce(p_firma_url, firma_url), updated_at = now()
  where id = p_solicitud;
end;
$$;

-- ============ RLS ============
alter table perfiles enable row level security;
alter table empleados enable row level security;
alter table inventario enable row level security;
alter table solicitudes enable row level security;
alter table solicitud_items enable row level security;
alter table movimientos_inventario enable row level security;

create policy "perfil propio o RH" on perfiles for select using (id = auth.uid() or es_rh());
create policy "RH gestiona perfiles" on perfiles for all using (es_rh()) with check (es_rh());

create policy "leer empleados" on empleados for select to authenticated using (estatus = 'activo' or es_rh());
create policy "RH gestiona empleados" on empleados for all using (es_rh()) with check (es_rh());

create policy "leer inventario" on inventario for select to authenticated using (true);
create policy "RH gestiona inventario" on inventario for all using (es_rh()) with check (es_rh());

-- Las solicitudes se crean vía crear_solicitud(); aquí sólo lectura y gestión de RH.
create policy "ver solicitudes propias o RH" on solicitudes for select using (supervisor_id = auth.uid() or es_rh());
create policy "RH actualiza solicitudes" on solicitudes for update using (es_rh()) with check (es_rh());

create policy "ver items" on solicitud_items for select using (
  exists (select 1 from solicitudes s where s.id = solicitud_id and (s.supervisor_id = auth.uid() or es_rh())));

create policy "RH ve movimientos" on movimientos_inventario for select using (es_rh());
create policy "RH registra movimientos" on movimientos_inventario for insert with check (es_rh());
