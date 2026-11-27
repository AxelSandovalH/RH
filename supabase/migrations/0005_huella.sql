-- Checada por huella dactilar con lector R503 conectado al kiosko (Web Serial).
--
-- Privacidad: la huella (plantilla) se queda DENTRO del lector. Aquí sólo se
-- guarda "en el kiosko X, la posición N del lector es el empleado Y".
-- Por eso las huellas son por dispositivo: si hay dos kioskos, se registra
-- la huella de la persona en cada uno.

-- Un kiosko fijo (Raspberry Pi con lector) no tiene GPS: no se valida geocerca.
alter table dispositivos add column if not exists requiere_gps boolean not null default true;

alter table checadas add column if not exists metodo text not null default 'rostro'
  check (metodo in ('rostro', 'huella'));

-- ============ Huellas registradas (sólo la posición en el lector) ============
create table huellas (
  id bigint generated always as identity primary key,
  dispositivo_id uuid not null references dispositivos(id) on delete cascade,
  slot integer not null check (slot >= 0),
  id_empleado text not null references empleados(id_empleado) on delete cascade,
  created_at timestamptz not null default now(),
  unique (dispositivo_id, slot)
);
create index huellas_empleado_idx on huellas (id_empleado);

-- ============ Solicitudes de registro de huella ============
-- RH pide "registra la huella de Juan en el kiosko X"; el kiosko lo ve,
-- pide el dedo dos veces, lo guarda en el lector y confirma la posición.
create table enrolamientos_huella (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references dispositivos(id) on delete cascade,
  id_empleado text not null references empleados(id_empleado) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'completado', 'fallido', 'cancelado')),
  slot integer,
  mensaje text,
  creado_por uuid references perfiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enrolamientos_pendientes_idx on enrolamientos_huella (dispositivo_id, created_at) where estado = 'pendiente';

alter table huellas enable row level security;
alter table enrolamientos_huella enable row level security;
create policy "RH gestiona huellas" on huellas for all using (es_rh()) with check (es_rh());
create policy "RH gestiona enrolamientos" on enrolamientos_huella for all using (es_rh()) with check (es_rh());

-- ============ Lógica común: alternar entrada/salida y guardar ============
-- Interna (sin permiso de ejecución para usuarios): la llaman las funciones públicas.
create or replace function _guardar_checada(
  p_disp uuid, p_ubi uuid, p_emp text, p_nombre text, p_metodo text,
  p_lat double precision, p_lng double precision, p_precision double precision,
  p_dist int, p_simil double precision, p_foto_path text, p_ubi_nombre text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ultima checadas%rowtype;
  v_tipo tipo_checada;
  v_inicio_dia timestamptz;
begin
  v_inicio_dia := date_trunc('day', now() at time zone zona_operacion()) at time zone zona_operacion();
  select * into v_ultima from checadas
  where id_empleado = p_emp and fecha >= v_inicio_dia
  order by fecha desc limit 1;

  if found and now() - v_ultima.fecha < interval '2 minutes' then
    return jsonb_build_object('ok', true, 'duplicada', true, 'tipo', v_ultima.tipo,
      'nombre', p_nombre, 'hora', v_ultima.fecha);
  end if;

  v_tipo := case when v_ultima.tipo = 'entrada' then 'salida' else 'entrada' end;

  insert into checadas (id_empleado, tipo, dispositivo_id, ubicacion_id, lat, lng,
                        precision_m, distancia_m, similitud, foto_path, metodo)
  values (p_emp, v_tipo, p_disp, p_ubi, p_lat, p_lng,
          p_precision::int, p_dist, p_simil, p_foto_path, p_metodo);

  return jsonb_build_object('ok', true, 'tipo', v_tipo, 'nombre', p_nombre,
    'ubicacion', p_ubi_nombre, 'hora', now());
end;
$$;
revoke execute on function _guardar_checada(uuid, uuid, text, text, text, double precision, double precision, double precision, int, double precision, text, text) from public, anon, authenticated;

-- Valida dispositivo y geocerca. Devuelve null si todo bien, o el jsonb de error.
create or replace function _validar_dispositivo(
  p_lat double precision, p_lng double precision, p_precision double precision, p_foto_path text,
  out o_disp dispositivos, out o_ubi ubicaciones, out o_dist int, out o_error jsonb
)
language plpgsql security definer set search_path = public as $$
declare
  v_tolerancia int;
begin
  select * into o_disp from dispositivos where id = auth.uid();
  if not found or not o_disp.activo then
    insert into checadas_rechazos (dispositivo_id, motivo, lat, lng, foto_path)
    values (auth.uid(), 'DISPOSITIVO_INACTIVO', p_lat, p_lng, p_foto_path);
    o_error := jsonb_build_object('ok', false, 'error', 'Este equipo no está habilitado como checador');
    return;
  end if;

  select * into o_ubi from ubicaciones where id = o_disp.ubicacion_id and activo;
  if not found then
    o_error := jsonb_build_object('ok', false, 'error', 'La ubicación de este checador está inactiva');
    return;
  end if;

  if not o_disp.requiere_gps then
    return;  -- kiosko fijo: no se valida geocerca
  end if;
  if p_lat is null or p_lng is null then
    o_error := jsonb_build_object('ok', false, 'error', 'Esperando la ubicación del GPS… intenta de nuevo.');
    return;
  end if;

  o_dist := distancia_metros(p_lat, p_lng, o_ubi.lat, o_ubi.lng);
  v_tolerancia := o_ubi.radio_metros + least(coalesce(p_precision, 0), 100)::int;
  if o_dist > v_tolerancia then
    insert into checadas_rechazos (dispositivo_id, motivo, detalle, lat, lng, precision_m, foto_path)
    values (o_disp.id, case when coalesce(p_precision, 0) > 300 then 'GPS_IMPRECISO' else 'FUERA_DE_ZONA' end,
            format('%s m de %s (tolerancia %s m)', o_dist, o_ubi.nombre, v_tolerancia),
            p_lat, p_lng, p_precision::int, p_foto_path);
    o_error := jsonb_build_object('ok', false, 'error',
      case when coalesce(p_precision, 0) > 300
        then 'El GPS del equipo está impreciso. Activa la ubicación precisa.'
        else format('El checador está a %s m de %s', o_dist, o_ubi.nombre) end);
  end if;
end;
$$;
revoke execute on function _validar_dispositivo(double precision, double precision, double precision, text) from public, anon, authenticated;

-- ============ Checada por rostro (misma firma que 0003, ahora con la lógica común) ============
create or replace function registrar_checada(
  p_descriptor double precision[],
  p_lat double precision,
  p_lng double precision,
  p_precision double precision default null,
  p_foto_path text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_emp text;
  v_nombre text;
  v_simil double precision;
begin
  select * into v from _validar_dispositivo(p_lat, p_lng, p_precision, p_foto_path);
  if v.o_error is not null then return v.o_error; end if;

  select r.id_empleado, e.nombre, distancia_facial(r.descriptor, p_descriptor) as d
    into v_emp, v_nombre, v_simil
  from rostros r join empleados e on e.id_empleado = r.id_empleado
  where e.estatus = 'activo'
  order by d asc
  limit 1;

  if v_emp is null or v_simil > 0.5 then
    insert into checadas_rechazos (dispositivo_id, motivo, detalle, lat, lng, precision_m, foto_path)
    values ((v.o_disp).id, 'NO_RECONOCIDO', format('mejor distancia %s', round(coalesce(v_simil, 9)::numeric, 3)),
            p_lat, p_lng, p_precision::int, p_foto_path);
    return jsonb_build_object('ok', false, 'error', 'No te reconocí. Acércate y mira a la cámara.');
  end if;

  return _guardar_checada((v.o_disp).id, (v.o_ubi).id, v_emp, v_nombre, 'rostro',
    p_lat, p_lng, p_precision, v.o_dist, v_simil, p_foto_path, (v.o_ubi).nombre);
end;
$$;

-- ============ Checada por huella ============
-- p_slot: posición que el lector R503 encontró para el dedo.
create or replace function registrar_checada_huella(
  p_slot integer,
  p_lat double precision default null,
  p_lng double precision default null,
  p_precision double precision default null,
  p_foto_path text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_emp text;
  v_nombre text;
begin
  select * into v from _validar_dispositivo(p_lat, p_lng, p_precision, p_foto_path);
  if v.o_error is not null then return v.o_error; end if;

  select h.id_empleado, e.nombre into v_emp, v_nombre
  from huellas h join empleados e on e.id_empleado = h.id_empleado
  where h.dispositivo_id = (v.o_disp).id and h.slot = p_slot and e.estatus = 'activo';

  if v_emp is null then
    insert into checadas_rechazos (dispositivo_id, motivo, detalle, lat, lng, precision_m, foto_path)
    values ((v.o_disp).id, 'HUELLA_SIN_EMPLEADO', format('posición %s del lector', p_slot),
            p_lat, p_lng, p_precision::int, p_foto_path);
    return jsonb_build_object('ok', false, 'error', 'Esta huella no está asignada a ningún empleado activo. Avisa a RH.');
  end if;

  return _guardar_checada((v.o_disp).id, (v.o_ubi).id, v_emp, v_nombre, 'huella',
    p_lat, p_lng, p_precision, v.o_dist, null, p_foto_path, (v.o_ubi).nombre);
end;
$$;
revoke execute on function registrar_checada_huella(integer, double precision, double precision, double precision, text) from public, anon;
grant execute on function registrar_checada_huella(integer, double precision, double precision, double precision, text) to authenticated;

-- Rechazo cuando el lector no encuentra la huella (no hay slot que mandar).
create or replace function registrar_huella_no_reconocida() returns void
language sql security definer set search_path = public as $$
  insert into checadas_rechazos (dispositivo_id, motivo, detalle)
  select id, 'HUELLA_NO_RECONOCIDA', 'el lector no encontró coincidencia'
  from dispositivos where id = auth.uid() and activo;
$$;
revoke execute on function registrar_huella_no_reconocida() from public, anon;
grant execute on function registrar_huella_no_reconocida() to authenticated;

-- ============ Registro de huellas desde el kiosko ============
-- Solicitud pendiente más reciente para este kiosko (vigencia 10 minutos).
create or replace function mi_enrolamiento_pendiente() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', en.id, 'id_empleado', en.id_empleado, 'nombre', e.nombre)
  from enrolamientos_huella en join empleados e on e.id_empleado = en.id_empleado
  where en.dispositivo_id = auth.uid() and en.estado = 'pendiente'
    and en.created_at > now() - interval '10 minutes'
  order by en.created_at desc limit 1;
$$;
revoke execute on function mi_enrolamiento_pendiente() from public, anon;
grant execute on function mi_enrolamiento_pendiente() to authenticated;

-- Posiciones del lector que ya están asignadas en este kiosko.
create or replace function mis_slots_huella() returns integer[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(slot order by slot), '{}') from huellas where dispositivo_id = auth.uid();
$$;
revoke execute on function mis_slots_huella() from public, anon;
grant execute on function mis_slots_huella() to authenticated;

-- El kiosko confirma el resultado del registro.
create or replace function terminar_enrolamiento_huella(p_id uuid, p_slot integer default null, p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v enrolamientos_huella%rowtype;
begin
  select * into v from enrolamientos_huella
  where id = p_id and dispositivo_id = auth.uid() and estado = 'pendiente' for update;
  if not found then raise exception 'Solicitud de registro inexistente o ya atendida'; end if;

  if p_error is not null or p_slot is null then
    update enrolamientos_huella set estado = 'fallido', mensaje = coalesce(p_error, 'Sin posición'), updated_at = now()
    where id = p_id;
    return;
  end if;

  -- La posición pasa a ser de este empleado (si estaba asignada a otro, se reemplaza).
  insert into huellas (dispositivo_id, slot, id_empleado) values (v.dispositivo_id, p_slot, v.id_empleado)
  on conflict (dispositivo_id, slot) do update set id_empleado = excluded.id_empleado, created_at = now();

  update enrolamientos_huella set estado = 'completado', slot = p_slot, updated_at = now() where id = p_id;
end;
$$;
revoke execute on function terminar_enrolamiento_huella(uuid, integer, text) from public, anon;
grant execute on function terminar_enrolamiento_huella(uuid, integer, text) to authenticated;

-- mi_dispositivo ahora también dice si el kiosko requiere GPS.
create or replace function mi_dispositivo() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre', d.nombre, 'activo', d.activo and u.activo,
                            'ubicacion', u.nombre, 'lat', u.lat, 'lng', u.lng, 'radio', u.radio_metros,
                            'requiere_gps', d.requiere_gps)
  from dispositivos d join ubicaciones u on u.id = d.ubicacion_id
  where d.id = auth.uid();
$$;
