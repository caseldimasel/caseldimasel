-- SIDONIA · Actualización (octubre 2026): subastas creadas solas desde Shopify.
-- Si ya ejecutaste sql/esquema.sql antes de esta fecha, pega esto en Supabase › SQL Editor y ejecútalo una vez.
-- (Si ejecutas el esquema completo desde cero, ya lo lleva.)

-- Subastas creadas desde Shopify: la ficha manda sus datos (firmados por el tema) y aquí se crea la subasta o se
-- pone al día. Sin pujas, se puede cambiar todo (también volver a abrir una que terminó sin pujas); con pujas, solo
-- el título, el final y la reserva; terminada con pujas (o anulada), solo el título. p_version (cuándo se pintó la ficha) evita
-- que una página vieja deshaga un cambio más nuevo.
alter table subastas add column if not exists version bigint not null default 0;

create or replace function sidonia_sincronizar(p_handle text, p_titulo text, p_inicio timestamptz, p_fin timestamptz,
  p_salida bigint, p_reserva bigint, p_version bigint, p_cliente text default null) returns jsonb
language plpgsql as $$
declare s subastas;
begin
  if p_salida is null or p_salida <= 0 or p_fin <= p_inicio then
    return jsonb_build_object('ok', false, 'error', 'datos');
  end if;
  insert into subastas (handle, titulo, inicio, fin, salida, reserva, version)
  values (p_handle, left(coalesce(p_titulo, ''), 300), p_inicio, p_fin, p_salida, nullif(p_reserva, 0), p_version)
  on conflict (handle) do nothing;
  if not found then
    select * into s from subastas where handle = p_handle for update;
    if p_version > s.version then
      if s.pujas = 0 and s.estado <> 'anulada' then
        update subastas set titulo = left(coalesce(p_titulo, ''), 300), inicio = p_inicio, fin = p_fin, salida = p_salida,
               reserva = nullif(p_reserva, 0), estado = 'proximamente', version = p_version, actualizada = now()
         where handle = p_handle;
      elsif s.estado in ('proximamente', 'en_directo') then
        update subastas set titulo = left(coalesce(p_titulo, ''), 300), fin = p_fin, reserva = nullif(p_reserva, 0),
               version = p_version, actualizada = now()
         where handle = p_handle;
      else
        update subastas set titulo = left(coalesce(p_titulo, ''), 300), version = p_version where handle = p_handle;
      end if;
    end if;
  end if;
  perform sidonia_al_dia(p_handle);
  return jsonb_build_object('ok', true, 'subasta', sidonia_estado_uno(p_handle, p_cliente));
end $$;

-- Seguridad en Supabase: las funciones solo las puede usar el servidor (clave de servicio), nunca la clave pública
-- (anon) ni un usuario de Supabase. Si no, cualquiera podría llamar a sidonia_pujar en nombre de otro cliente.
revoke execute on all functions in schema public from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from public, anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end $$;
