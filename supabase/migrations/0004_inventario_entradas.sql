-- Entradas y ajustes de inventario en una sola transacción (stock + kardex).
create or replace function registrar_movimiento_inventario(
  p_sku text,
  p_cantidad integer,      -- positiva = entrada; negativa = ajuste a la baja
  p_nota text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_nueva int;
begin
  if not es_rh() then raise exception 'Sólo RH puede mover inventario'; end if;
  if p_cantidad = 0 then raise exception 'La cantidad no puede ser cero'; end if;

  update inventario set cantidad_disponible = cantidad_disponible + p_cantidad
  where sku = p_sku and cantidad_disponible + p_cantidad >= 0
  returning cantidad_disponible into v_nueva;
  if not found then raise exception 'SKU inexistente o el ajuste dejaría stock negativo'; end if;

  insert into movimientos_inventario (sku, tipo, cantidad, nota)
  values (p_sku, case when p_cantidad > 0 then 'entrada' else 'ajuste' end::tipo_movimiento, p_cantidad, p_nota);

  return v_nueva;
end;
$$;

revoke execute on function registrar_movimiento_inventario(text, integer, text) from public, anon;
grant execute on function registrar_movimiento_inventario(text, integer, text) to authenticated;
