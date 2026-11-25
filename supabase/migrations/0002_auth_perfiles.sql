-- Crea el perfil automáticamente al primer inicio de sesión.
-- Los perfiles nuevos quedan INACTIVOS hasta que RH los active y les asigne rol,
-- para que una cuenta nueva no obtenga acceso por sí sola.

alter table perfiles alter column activo set default false;
alter table perfiles add column if not exists email text;
update perfiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

create or replace function crear_perfil_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, email, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.email,
    'supervisor',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function crear_perfil_nuevo_usuario();

-- Las funciones no deben poder llamarse sin sesión.
revoke execute on function consumo_anual(text) from public, anon;
revoke execute on function crear_solicitud(text, jsonb, text) from public, anon;
revoke execute on function entregar_solicitud(uuid, text) from public, anon;
revoke execute on function es_rh() from public, anon;
grant execute on function consumo_anual(text) to authenticated;
grant execute on function crear_solicitud(text, jsonb, text) to authenticated;
grant execute on function entregar_solicitud(uuid, text) to authenticated;
grant execute on function es_rh() to authenticated;

-- Sólo usuarios activos pueden consultar el consumo anual.
create or replace function consumo_anual(p_empleado text) returns integer
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from perfiles where id = auth.uid() and activo) then 0
  else (
    select coalesce(sum(i.cantidad), 0)::int
    from solicitudes s join solicitud_items i on i.solicitud_id = s.id
    where s.id_empleado = p_empleado
      and s.estatus = 'entregada'
      and s.fecha_entrega >= now() - interval '12 months'
  ) end;
$$;

-- Para dar de alta al primer usuario de RH (después de crearlo en Authentication → Users):
--   update perfiles set rol = 'admin', activo = true where email = 'correo@empresa.com';
