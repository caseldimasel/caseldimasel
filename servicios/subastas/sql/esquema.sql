-- SIDONIA · Motor de subastas: tablas y funciones (PostgreSQL 15+, pensado para Supabase).
--
-- Toda la lógica de pujar vive aquí, dentro de una transacción que bloquea la fila de la subasta (FOR UPDATE):
-- aunque pujen cientos de personas a la vez, cada puja se resuelve una detrás de otra y nunca se pisan.
--
-- Reglas (las mismas que enseña el tema):
--   · Incremento mínimo: 100 € hasta 15.000 €, 250 € hasta 50.000 €, 500 € hasta 200.000 € y 1.000 € después.
--   · Puja directa: pujas exactamente esa cantidad. Puja máxima: el motor puja por ti lo justo para que vayas ganando,
--     hasta tu máximo. Si dos máximas empatan, gana la que llegó antes.
--   · Cierre suave: una puja en los últimos minutos (subastas.cierre_suave_s) devuelve el reloj a esos minutos.
--   · Al terminar: «vendida» si hay pujas y se llegó a la reserva (o no tiene reserva); si no, «reserva_no_alcanzada».
--   · Solo pujan clientes registrados para pujar (pujadores.registrado: móvil verificado y tarjeta guardada).
--   · Cada puja lleva un «intento» único: si el móvil reenvía la misma puja, no se cuenta dos veces.
--
-- Uso desde el servidor (Supabase REST, con la clave de servicio): rpc/sidonia_estado, rpc/sidonia_pujar,
-- rpc/sidonia_comentar, rpc/sidonia_seguir. Las tablas no se exponen al público (RLS activado, sin políticas).

create table if not exists subastas (
  handle          text primary key,                 -- el handle del producto en Shopify
  titulo          text not null default '',
  estado          text not null default 'proximamente'
                  check (estado in ('proximamente', 'en_directo', 'vendida', 'reserva_no_alcanzada', 'anulada')),
  inicio          timestamptz not null,
  fin             timestamptz not null,
  salida          bigint not null check (salida > 0),  -- euros enteros
  reserva         bigint,                            -- null = sin reserva (secreta: nunca sale del motor)
  cierre_suave_s  int not null default 120,
  puja            bigint not null default 0,         -- puja actual (0 = sin pujas)
  pujas           int not null default 0,
  lider           text,                              -- id del cliente que va ganando
  lider_maxima    bigint not null default 0,         -- su máximo (secreto)
  vendedor        text,                              -- id del cliente vendedor, si lo tiene (no puede pujar)
  actualizada     timestamptz not null default now()
);

create table if not exists pujadores (
  cliente       text primary key,                    -- id del cliente de Shopify
  alias         text not null,                       -- nombre de usuario público
  email         text,
  registrado    boolean not null default false,      -- móvil verificado y tarjeta guardada
  tarjeta       text,                                -- «Visa •••• 4242» (nunca el número)
  stripe_cliente text,
  creado        timestamptz not null default now()
);

create table if not exists pujas (
  id        bigserial primary key,
  handle    text not null references subastas(handle) on delete cascade,
  cliente   text not null,
  importe   bigint not null,
  auto      boolean not null default false,          -- puesta por la puja máxima
  intento   text,
  creada    timestamptz not null default clock_timestamp()
);
create index if not exists pujas_handle on pujas (handle, id desc);
create unique index if not exists pujas_intento on pujas (cliente, intento) where intento is not null;

create table if not exists comentarios (
  id          bigserial primary key,
  handle      text not null references subastas(handle) on delete cascade,
  cliente     text,
  rol         text check (rol in ('vendedor', 'sidonia')),
  texto       text not null check (length(texto) between 1 and 2000),
  respuesta_a bigint references comentarios(id) on delete cascade,
  oculto      boolean not null default false,
  creado      timestamptz not null default now()
);
create index if not exists comentarios_handle on comentarios (handle, id);

create table if not exists seguidores (
  handle  text not null references subastas(handle) on delete cascade,
  cliente text not null,
  creado  timestamptz not null default now(),
  primary key (handle, cliente)
);

alter table subastas enable row level security;
alter table pujadores enable row level security;
alter table pujas enable row level security;
alter table comentarios enable row level security;
alter table seguidores enable row level security;

-- Incremento mínimo según la puja
create or replace function sidonia_incremento(n bigint) returns bigint language sql immutable as $$
  select case when n < 15000 then 100 when n < 50000 then 250 when n < 200000 then 500 else 1000 end::bigint
$$;

create or replace function sidonia_minima(s subastas) returns bigint language sql immutable as $$
  select case when s.puja > 0 then s.puja + sidonia_incremento(s.puja) else s.salida end
$$;

-- Pone el estado al día según la hora: empieza, o termina y se decide el resultado
create or replace function sidonia_al_dia(p_handle text) returns subastas language plpgsql as $$
declare s subastas;
begin
  select * into s from subastas where handle = p_handle for update;
  if not found then return null; end if;
  if s.estado = 'proximamente' and now() >= s.inicio and now() < s.fin then
    update subastas set estado = 'en_directo', actualizada = now() where handle = p_handle returning * into s;
  end if;
  if s.estado in ('proximamente', 'en_directo') and now() >= s.fin then
    update subastas
       set estado = case when s.pujas > 0 and (s.reserva is null or s.puja >= s.reserva) then 'vendida' else 'reserva_no_alcanzada' end,
           actualizada = now()
     where handle = p_handle returning * into s;
  end if;
  return s;
end $$;

-- Apunta una puja y alarga el reloj si cae en el cierre suave
create or replace function sidonia_apuntar(p_handle text, p_cliente text, p_importe bigint, p_auto boolean, p_intento text)
returns void language plpgsql as $$
begin
  insert into pujas (handle, cliente, importe, auto, intento) values (p_handle, p_cliente, p_importe, p_auto, p_intento);
  update subastas
     set puja = p_importe, pujas = pujas + 1,
         fin = greatest(fin, now() + make_interval(secs => cierre_suave_s)),
         actualizada = now()
   where handle = p_handle;
end $$;

-- Pujar. Devuelve { ok, error?, subasta }.
-- error: registro | minimo | cerrada | superado | no_permitido | no_existe
create or replace function sidonia_pujar(p_handle text, p_cliente text, p_importe bigint, p_tipo text default 'directa', p_intento text default null)
returns jsonb language plpgsql as $$
declare
  s subastas;
  minima bigint;
  rival text;
  rival_max bigint;
  precio bigint;
begin
  if p_intento is not null and exists (select 1 from pujas where cliente = p_cliente and intento = p_intento) then
    return jsonb_build_object('ok', true, 'repetida', true, 'subasta', sidonia_estado_uno(p_handle, p_cliente));
  end if;
  if not exists (select 1 from pujadores where cliente = p_cliente and registrado) then
    return jsonb_build_object('ok', false, 'error', 'registro', 'subasta', sidonia_estado_uno(p_handle, p_cliente));
  end if;

  s := sidonia_al_dia(p_handle);  -- bloquea la fila hasta el final de la transacción
  if s.handle is null then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  if s.estado <> 'en_directo' or now() >= s.fin then
    return jsonb_build_object('ok', false, 'error', 'cerrada', 'subasta', sidonia_estado_uno(p_handle, p_cliente));
  end if;
  if s.vendedor = p_cliente then
    return jsonb_build_object('ok', false, 'error', 'no_permitido', 'subasta', sidonia_estado_uno(p_handle, p_cliente));
  end if;

  minima := sidonia_minima(s);
  rival := s.lider;
  rival_max := s.lider_maxima;

  -- Ya vas ganando: subir tu máximo, o pujar más alto a propósito
  if rival = p_cliente then
    if p_tipo = 'maxima' then
      if p_importe <= greatest(rival_max, s.puja) then
        return jsonb_build_object('ok', false, 'error', 'minimo', 'subasta', sidonia_estado_uno(p_handle, p_cliente));
      end if;
      update subastas set lider_maxima = p_importe, actualizada = now() where handle = p_handle;
    else
      if p_importe < minima then
        return jsonb_build_object('ok', false, 'error', 'minimo', 'subasta', sidonia_estado_uno(p_handle, p_cliente));
      end if;
      perform sidonia_apuntar(p_handle, p_cliente, p_importe, false, p_intento);
      update subastas set lider_maxima = greatest(rival_max, p_importe) where handle = p_handle;
    end if;
    return jsonb_build_object('ok', true, 'subasta', sidonia_estado_uno(p_handle, p_cliente));
  end if;

  if p_importe < minima then
    return jsonb_build_object('ok', false, 'error', 'minimo', 'subasta', sidonia_estado_uno(p_handle, p_cliente));
  end if;

  -- El que va ganando tiene una máxima que cubre tu puja: se apunta la tuya y su máxima responde sola
  if rival is not null and rival_max >= p_importe then
    perform sidonia_apuntar(p_handle, p_cliente, p_importe, false, p_intento);
    precio := least(rival_max, p_importe + sidonia_incremento(p_importe));
    if precio > p_importe then
      perform sidonia_apuntar(p_handle, rival, precio, true, null);
    else
      -- Empate con su máximo: gana quien llegó antes, al mismo precio
      update subastas set puja = p_importe where handle = p_handle;
    end if;
    update subastas set lider = rival where handle = p_handle;
    return jsonb_build_object('ok', false, 'error', 'superado', 'subasta', sidonia_estado_uno(p_handle, p_cliente));
  end if;

  -- Pasas a ir ganando
  if p_tipo = 'maxima' then
    -- Lo justo para superar al anterior (su máxima, si la tenía), sin pasar de tu máximo
    if rival is not null and rival_max > s.puja then
      perform sidonia_apuntar(p_handle, rival, rival_max, true, null);
      precio := least(p_importe, rival_max + sidonia_incremento(rival_max));
    else
      precio := minima;
    end if;
  else
    if rival is not null and rival_max > s.puja then
      perform sidonia_apuntar(p_handle, rival, rival_max, true, null);
    end if;
    precio := p_importe;
  end if;
  perform sidonia_apuntar(p_handle, p_cliente, precio, false, p_intento);
  update subastas set lider = p_cliente, lider_maxima = p_importe, actualizada = now() where handle = p_handle;
  return jsonb_build_object('ok', true, 'subasta', sidonia_estado_uno(p_handle, p_cliente));
end $$;

-- Estado público de una subasta, visto por un cliente (o por nadie: p_cliente null)
create or replace function sidonia_estado_uno(p_handle text, p_cliente text default null) returns jsonb
language plpgsql as $$
declare
  s subastas;
  yo pujadores;
begin
  select * into s from subastas where handle = p_handle;
  if not found then return null; end if;
  if p_cliente is not null then select * into yo from pujadores where cliente = p_cliente; end if;
  return jsonb_build_object(
    'handle', s.handle,
    'estado', s.estado,
    'inicio', s.inicio,
    'fin', s.fin,
    'salida', s.salida,
    'puja', s.puja,
    'pujas', s.pujas,
    'sin_reserva', s.reserva is null,
    'reserva_ok', s.reserva is null or (s.puja > 0 and s.puja >= s.reserva),
    'lider_eres_tu', p_cliente is not null and s.lider = p_cliente,
    'ganador', case when s.estado = 'vendida' then (select alias from pujadores where cliente = s.lider) end,
    'seguidores', (select count(*) from seguidores where handle = s.handle),
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object('u', case when p.cliente = p_cliente then 'tú' else coalesce(a.alias, 'pujador') end,
                                          'importe', p.importe, 't', p.creada, 'auto', p.auto) order by p.id desc)
        from (select * from pujas where handle = s.handle order by id desc limit 60) p
        left join pujadores a on a.cliente = p.cliente), '[]'::jsonb),
    'comentarios', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id::text, 'u', case when c.cliente = p_cliente then 'tú' else coalesce(a.alias, 'Sidonia') end,
                                          'rol', c.rol, 'texto', c.texto, 't', c.creado, 'respuesta_a', c.respuesta_a::text) order by c.id)
        from comentarios c left join pujadores a on a.cliente = c.cliente
       where c.handle = s.handle and not c.oculto), '[]'::jsonb),
    'tu', jsonb_build_object(
      'registrado', coalesce(yo.registrado, false),
      'tarjeta', yo.tarjeta,
      'maxima', case when p_cliente is not null and s.lider = p_cliente and s.lider_maxima > s.puja then s.lider_maxima end,
      'pujaste', p_cliente is not null and exists (select 1 from pujas where handle = s.handle and cliente = p_cliente),
      'sigues', p_cliente is not null and exists (select 1 from seguidores where handle = s.handle and cliente = p_cliente)
    )
  );
end $$;

-- Estado de varias subastas a la vez (la ficha y el listado). Pone al día las que hayan empezado o terminado.
create or replace function sidonia_estado(p_handles text[], p_cliente text default null) returns jsonb
language plpgsql as $$
declare h text; out jsonb := '[]'::jsonb;
begin
  foreach h in array p_handles[1:60] loop
    perform sidonia_al_dia(h);
    if exists (select 1 from subastas where handle = h) then
      out := out || jsonb_build_array(sidonia_estado_uno(h, p_cliente));
    end if;
  end loop;
  return jsonb_build_object('ahora', now(), 'subastas', out);
end $$;

create or replace function sidonia_comentar(p_handle text, p_cliente text, p_texto text, p_respuesta_a bigint default null)
returns jsonb language plpgsql as $$
begin
  if not exists (select 1 from pujadores where cliente = p_cliente) then
    return jsonb_build_object('ok', false, 'error', 'registro');
  end if;
  if not exists (select 1 from subastas where handle = p_handle) then
    return jsonb_build_object('ok', false, 'error', 'no_existe');
  end if;
  insert into comentarios (handle, cliente, texto, respuesta_a)
  values (p_handle, p_cliente, left(trim(p_texto), 2000), p_respuesta_a);
  return jsonb_build_object('ok', true, 'subasta', sidonia_estado_uno(p_handle, p_cliente));
end $$;

create or replace function sidonia_seguir(p_handle text, p_cliente text, p_on boolean) returns jsonb
language plpgsql as $$
begin
  if p_on then
    insert into seguidores (handle, cliente) values (p_handle, p_cliente) on conflict do nothing;
  else
    delete from seguidores where handle = p_handle and cliente = p_cliente;
  end if;
  return jsonb_build_object('ok', true, 'subasta', sidonia_estado_uno(p_handle, p_cliente));
end $$;

-- Registro para pujar: nombre de usuario (único) y, cuando Stripe confirma la tarjeta, registrado = true
create unique index if not exists pujadores_alias on pujadores (lower(alias));

create or replace function sidonia_registrar(p_cliente text, p_alias text, p_email text) returns jsonb
language plpgsql as $$
declare a text := left(regexp_replace(trim(p_alias), '[^A-Za-z0-9_.áéíóúñÁÉÍÓÚÑ-]', '', 'g'), 24);
begin
  if length(a) < 3 then return jsonb_build_object('ok', false, 'error', 'alias'); end if;
  if exists (select 1 from pujadores where lower(alias) = lower(a) and cliente <> p_cliente) then
    return jsonb_build_object('ok', false, 'error', 'alias_ocupado');
  end if;
  insert into pujadores (cliente, alias, email) values (p_cliente, a, p_email)
  on conflict (cliente) do update set alias = excluded.alias, email = coalesce(excluded.email, pujadores.email);
  return jsonb_build_object('ok', true, 'pujador', (select to_jsonb(p) - 'stripe_cliente' from pujadores p where cliente = p_cliente));
end $$;

create or replace function sidonia_pujador(p_cliente text) returns jsonb language sql as $$
  select to_jsonb(p) from pujadores p where cliente = p_cliente
$$;

create or replace function sidonia_registro_ok(p_cliente text, p_tarjeta text, p_stripe text) returns jsonb
language plpgsql as $$
begin
  update pujadores set registrado = true, tarjeta = p_tarjeta, stripe_cliente = coalesce(p_stripe, stripe_cliente)
   where cliente = p_cliente;
  return jsonb_build_object('ok', found);
end $$;

create or replace function sidonia_stripe_cliente(p_cliente text, p_stripe text) returns void language sql as $$
  update pujadores set stripe_cliente = p_stripe where cliente = p_cliente
$$;

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
