-- Módulo de Asistencia: checado por reconocimiento facial en celular-kiosko.
--
-- Flujo: un celular queda dado de alta como "dispositivo" (es un usuario de
-- Supabase Auth ligado a una ubicación). El empleado se para frente a la
-- cámara; el navegador calcula el descriptor facial (128 números) y llama a
-- registrar_checada(), que identifica a la persona, valida la geocerca y
-- alterna ENTRADA/SALIDA. La foto queda como evidencia en Storage.

-- ============ Ubicaciones (geocercas) ============
create table ubicaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  lat double precision not null,
  lng double precision not null,
  radio_metros integer not null default 150 check (radio_metros between 20 and 5000),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ Dispositivos kiosko ============
-- id = usuario de Supabase Auth con el que inicia sesión el celular.
create table dispositivos (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  ubicacion_id uuid not null references ubicaciones(id),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ Rostros registrados ============
-- Un empleado puede tener varias muestras (mejora el reconocimiento).
create table rostros (
  id bigint generated always as identity primary key,
  id_empleado text not null references empleados(id_empleado) on delete cascade,
  descriptor double precision[] not null check (array_length(descriptor, 1) = 128),
  foto_path text,
  created_at timestamptz not null default now()
);
create index rostros_empleado_idx on rostros (id_empleado);

-- ============ Checadas ============
create type tipo_checada as enum ('entrada', 'salida');

create table checadas (
  id uuid primary key default gen_random_uuid(),
  id_empleado text not null references empleados(id_empleado),
  tipo tipo_checada not null,
  fecha timestamptz not null default now(),
  dispositivo_id uuid references dispositivos(id) on delete set null,
  ubicacion_id uuid references ubicaciones(id) on delete set null,
  lat double precision,
  lng double precision,
  precision_m integer,
  distancia_m integer,
  similitud real,          -- distancia facial (menor = más parecido)
  foto_path text
);
create index checadas_empleado_fecha_idx on checadas (id_empleado, fecha desc);
create index checadas_fecha_idx on checadas (fecha desc);

-- Intentos rechazados, para diagnosticar "no me deja checar".
create table checadas_rechazos (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  dispositivo_id uuid,
  id_empleado text,
  motivo text not null,     -- NO_RECONOCIDO, FUERA_DE_ZONA, GPS_IMPRECISO, DISPOSITIVO_INACTIVO
  detalle text,
  lat double precision,
  lng double precision,
  precision_m integer,
  foto_path text
);

-- ============ Utilidades ============
create or replace function distancia_metros(lat1 double precision, lng1 double precision,
                                            lat2 double precision, lng2 double precision)
returns integer language sql immutable as $$
  select round(2 * 6371000 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2)))::int;
$$;

create or replace function distancia_facial(a double precision[], b double precision[])
returns double precision language sql immutable as $$
  select sqrt(sum((x - y) ^ 2)) from unnest(a, b) as t(x, y);
$$;

-- Zona horaria de operación (para saber qué es "hoy").
create or replace function zona_operacion() returns text language sql immutable as $$
  select 'America/Mexico_City';
$$;

-- ============ Registrar checada ============
-- Umbral de reconocimiento: 0.5 (face-api sugiere 0.6; usamos uno más estricto).
create or replace function registrar_checada(
  p_descriptor double precision[],
  p_lat double precision,
  p_lng double precision,
  p_precision double precision default null,
  p_foto_path text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_disp dispositivos%rowtype;
  v_ubi ubicaciones%rowtype;
  v_dist int;
  v_tolerancia int;
  v_emp text;
  v_nombre text;
  v_simil double precision;
  v_ultima checadas%rowtype;
  v_tipo tipo_checada;
  v_id uuid;
  v_inicio_dia timestamptz;
begin
  select * into v_disp from dispositivos where id = auth.uid();
  if not found or not v_disp.activo then
    insert into checadas_rechazos (dispositivo_id, motivo, lat, lng, foto_path)
    values (auth.uid(), 'DISPOSITIVO_INACTIVO', p_lat, p_lng, p_foto_path);
    return jsonb_build_object('ok', false, 'error', 'Este celular no está habilitado como checador');
  end if;

  -- 1. Geocerca: el celular debe seguir en su ubicación asignada.
  select * into v_ubi from ubicaciones where id = v_disp.ubicacion_id and activo;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'La ubicación de este checador está inactiva');
  end if;
  v_dist := distancia_metros(p_lat, p_lng, v_ubi.lat, v_ubi.lng);
  v_tolerancia := v_ubi.radio_metros + least(coalesce(p_precision, 0), 100)::int;
  if v_dist > v_tolerancia then
    insert into checadas_rechazos (dispositivo_id, motivo, detalle, lat, lng, precision_m, foto_path)
    values (v_disp.id, case when coalesce(p_precision, 0) > 300 then 'GPS_IMPRECISO' else 'FUERA_DE_ZONA' end,
            format('%s m de %s (tolerancia %s m)', v_dist, v_ubi.nombre, v_tolerancia),
            p_lat, p_lng, p_precision::int, p_foto_path);
    return jsonb_build_object('ok', false, 'error',
      case when coalesce(p_precision, 0) > 300
        then 'El GPS del celular está impreciso. Activa la ubicación precisa.'
        else format('El checador está a %s m de %s', v_dist, v_ubi.nombre) end);
  end if;

  -- 2. Identificar a la persona: rostro registrado más parecido.
  select r.id_empleado, e.nombre, distancia_facial(r.descriptor, p_descriptor) as d
    into v_emp, v_nombre, v_simil
  from rostros r join empleados e on e.id_empleado = r.id_empleado
  where e.estatus = 'activo'
  order by d asc
  limit 1;

  if v_emp is null or v_simil > 0.5 then
    insert into checadas_rechazos (dispositivo_id, motivo, detalle, lat, lng, precision_m, foto_path)
    values (v_disp.id, 'NO_RECONOCIDO', format('mejor distancia %s', round(coalesce(v_simil, 9)::numeric, 3)),
            p_lat, p_lng, p_precision::int, p_foto_path);
    return jsonb_build_object('ok', false, 'error', 'No te reconocí. Acércate y mira a la cámara.');
  end if;

  -- 3. Alternar entrada/salida del día, con protección contra doble registro.
  v_inicio_dia := date_trunc('day', now() at time zone zona_operacion()) at time zone zona_operacion();
  select * into v_ultima from checadas
  where id_empleado = v_emp and fecha >= v_inicio_dia
  order by fecha desc limit 1;

  if found and now() - v_ultima.fecha < interval '2 minutes' then
    return jsonb_build_object('ok', true, 'duplicada', true, 'tipo', v_ultima.tipo,
      'nombre', v_nombre, 'hora', v_ultima.fecha);
  end if;

  v_tipo := case when v_ultima.tipo = 'entrada' then 'salida' else 'entrada' end;

  insert into checadas (id_empleado, tipo, dispositivo_id, ubicacion_id, lat, lng,
                        precision_m, distancia_m, similitud, foto_path)
  values (v_emp, v_tipo, v_disp.id, v_ubi.id, p_lat, p_lng,
          p_precision::int, v_dist, v_simil, p_foto_path)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'tipo', v_tipo, 'nombre', v_nombre,
    'ubicacion', v_ubi.nombre, 'hora', now());
end;
$$;

revoke execute on function registrar_checada(double precision[], double precision, double precision, double precision, text) from public, anon;
grant execute on function registrar_checada(double precision[], double precision, double precision, double precision, text) to authenticated;

-- Datos del checador para la pantalla (nombre y ubicación).
create or replace function mi_dispositivo() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre', d.nombre, 'activo', d.activo and u.activo,
                            'ubicacion', u.nombre, 'lat', u.lat, 'lng', u.lng, 'radio', u.radio_metros)
  from dispositivos d join ubicaciones u on u.id = d.ubicacion_id
  where d.id = auth.uid();
$$;
revoke execute on function mi_dispositivo() from public, anon;
grant execute on function mi_dispositivo() to authenticated;

-- ============ RLS ============
alter table ubicaciones enable row level security;
alter table dispositivos enable row level security;
alter table rostros enable row level security;
alter table checadas enable row level security;
alter table checadas_rechazos enable row level security;

create policy "RH gestiona ubicaciones" on ubicaciones for all using (es_rh()) with check (es_rh());
create policy "RH gestiona dispositivos" on dispositivos for all using (es_rh()) with check (es_rh());
create policy "RH gestiona rostros" on rostros for all using (es_rh()) with check (es_rh());
create policy "RH ve checadas" on checadas for select using (es_rh());
create policy "RH ve rechazos" on checadas_rechazos for select using (es_rh());

-- ============ Storage: fotos de checadas y rostros ============
insert into storage.buckets (id, name, public) values ('asistencia', 'asistencia', false)
on conflict (id) do nothing;

-- El checador sube fotos sólo dentro de su carpeta: checadas/<id dispositivo>/...
create policy "checador sube fotos" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'asistencia'
    and (storage.foldername(name))[1] = 'checadas'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (select 1 from public.dispositivos where id = auth.uid() and activo)
  );

create policy "RH gestiona fotos" on storage.objects for all to authenticated
  using (bucket_id = 'asistencia' and public.es_rh())
  with check (bucket_id = 'asistencia' and public.es_rh());
