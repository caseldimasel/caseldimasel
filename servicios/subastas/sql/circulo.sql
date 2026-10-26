-- SIDONIA · Anuncios de dueños: coches, motos, barcos y casas que publican sus dueños (particulares o profesionales),
-- revisados por Sidonia. Salen en la web con el resto, con «Dueño particular» o «Dueño profesional».
--
-- Cada cliente de Shopify (con su sesión iniciada) puede tener varios anuncios activos (en revisión, aprobado o
-- publicado), hasta 25: el primero es gratis un mes y el resto se pagan por meses (sql/comunidad.sql, lib/comunidad.mjs). Las fotos van a Supabase Storage (cubo «anuncios»,
-- público para leer; solo el servidor da permisos para subir).
--
-- Estados: pendiente → aprobado → publicado (ficha creada en Shopify) · rechazado · retirado.
-- Pégalo en Supabase › SQL Editor y ejecútalo (se puede repetir sin problema).

create table if not exists anuncios (
  id                bigserial primary key,
  cliente           text not null,                         -- id del cliente de Shopify
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente', 'aprobado', 'rechazado', 'publicado', 'vendido', 'retirado')),
  tipo              text not null check (tipo in ('coche', 'moto', 'barco', 'casa')),
  titulo            text not null,
  precio            bigint,                                -- euros; null = a consultar
  ubicacion         text not null default '',
  resumen           text not null default '',              -- descripción breve
  historia          text not null default '',              -- su historia
  mecanica          text not null default '',              -- descripción mecánica / estado
  ficha             jsonb not null default '[]'::jsonb,    -- [["Año","1967"], ["Kilometraje","82.000 km"], …]
  fotos             jsonb not null default '[]'::jsonb,    -- rutas en el cubo «anuncios», la primera es la portada
  vendedor_nombre   text not null,                         -- el nombre que se enseña: «Enrique»
  vendedor_slug     text not null,                         -- su perfil: /collections/all/vendedor-<slug>?view=vendedor
  vendedor_tipo     text not null default 'particular' check (vendedor_tipo in ('particular', 'profesional')),
  telefono          text not null,
  email             text not null default '',
  acepta_telefono   boolean not null default false,        -- ha aceptado que se vea su teléfono en el anuncio
  nota              text not null default '',              -- nota del equipo (por qué se rechaza…)
  producto          text not null default '',              -- handle del producto en Shopify, al publicarlo
  creado            timestamptz not null default now(),
  actualizado       timestamptz not null default now()
);

-- Si la tabla ya existía de antes: motos y particular/profesional
alter table anuncios add column if not exists vendedor_tipo text not null default 'particular';
alter table anuncios drop constraint if exists anuncios_tipo_check;
alter table anuncios add constraint anuncios_tipo_check check (tipo in ('coche', 'moto', 'barco', 'casa'));
alter table anuncios drop constraint if exists anuncios_vendedor_tipo_check;
alter table anuncios add constraint anuncios_vendedor_tipo_check check (vendedor_tipo in ('particular', 'profesional'));
-- Cambios que hace el dueño en un anuncio aprobado o publicado: quedan aquí hasta que el equipo los aprueba (panel › Cambios)
alter table anuncios add column if not exists revision jsonb;
alter table anuncios add column if not exists revision_fecha timestamptz;
-- Vendido (deja de contar como su anuncio gratis: puede publicar otro) y reservado (sigue publicado, con la etiqueta)
alter table anuncios drop constraint if exists anuncios_estado_check;
alter table anuncios add constraint anuncios_estado_check check (estado in ('pendiente', 'aprobado', 'rechazado', 'publicado', 'vendido', 'retirado'));
alter table anuncios add column if not exists reservado boolean not null default false;

-- Perfil de cada vendedor: nombre que se enseña (persona o negocio), particular o profesional, descripción y foto/logo.
-- Lo edita él desde «Mi perfil» y se ve en su perfil público y en sus anuncios.
create table if not exists perfiles (
  cliente      text primary key,                      -- id del cliente de Shopify
  slug         text unique,                           -- el de sus anuncios: /collections/all/vendedor-<slug>?view=vendedor
  nombre       text not null default '',
  tipo         text not null default 'particular' check (tipo in ('particular', 'profesional')),
  descripcion  text not null default '',
  foto         text not null default '',              -- ruta en el cubo «anuncios»
  actualizado  timestamptz not null default now()
);
alter table perfiles enable row level security;

-- Móviles con la app de Sidonia, para mandarles avisos (lib/avisos.mjs): el token de Firebase de cada móvil y, si ha
-- iniciado sesión, de qué cliente es («Tu anuncio ya está publicado»). Solo lo lee y escribe el servidor.
create table if not exists dispositivos (
  token       text primary key,
  plataforma  text not null default 'otra',            -- ios · android
  cliente     text,                                    -- id del cliente de Shopify (si ha iniciado sesión)
  creado      timestamptz not null default now(),
  visto       timestamptz not null default now()
);
create index if not exists dispositivos_cliente on dispositivos (cliente);
alter table dispositivos enable row level security;

-- Alertas de búsqueda: «Avísame cuando entre uno así» (lib/alertas.mjs). Una vez al día se repasan los anuncios nuevos.
create table if not exists alertas (
  id         bigint generated by default as identity primary key,
  cliente    text not null,                              -- id del cliente de Shopify
  email      text,                                       -- adónde mandar el aviso
  nombre     text not null,                              -- «Porsche · hasta 80.000 €»
  filtros    jsonb not null default '{}'::jsonb,         -- q, coleccion, tipo, marca, anio, precio, combustible, localizacion
  activa     boolean not null default true,
  avisos     integer not null default 0,                 -- cuántos anuncios se le han avisado
  creada     timestamptz not null default now(),
  revisada   timestamptz not null default now()          -- hasta cuándo se han mirado los anuncios nuevos
);
create index if not exists alertas_cliente on alertas (cliente);
alter table alertas enable row level security;

-- Antes era un anuncio activo por persona; ahora puede tener varios (los demás, de pago)
drop index if exists anuncios_uno_activo;
create index if not exists anuncios_cliente on anuncios (cliente, estado);
create index if not exists anuncios_estado on anuncios (estado, creado desc);
alter table anuncios enable row level security;

-- El anuncio activo (o el último) de un cliente
create or replace function sidonia_anuncio_mio(p_cliente text) returns jsonb language sql stable as $$
  select coalesce((
    select jsonb_build_object('id', id, 'estado', estado, 'tipo', tipo, 'titulo', titulo, 'nota', nota, 'producto', producto, 'creado', creado)
      from anuncios where cliente = p_cliente
     order by (estado in ('pendiente', 'aprobado', 'publicado')) desc, creado desc limit 1
  ), 'null'::jsonb)
$$;

-- Guardar una solicitud nueva (los datos ya vienen revisados por el servidor)
create or replace function sidonia_anuncio_nuevo(p_cliente text, p jsonb) returns jsonb language plpgsql as $$
declare a anuncios;
begin
  if (select count(*) from anuncios where cliente = p_cliente and estado in ('pendiente', 'aprobado', 'publicado')) >= 25 then
    return jsonb_build_object('ok', false, 'error', 'limite', 'anuncio', sidonia_anuncio_mio(p_cliente));
  end if;
  insert into anuncios (cliente, tipo, titulo, precio, ubicacion, resumen, historia, mecanica, ficha, fotos,
                        vendedor_nombre, vendedor_slug, vendedor_tipo, telefono, email, acepta_telefono)
  values (p_cliente, p->>'tipo', left(p->>'titulo', 120), nullif(p->>'precio', '')::bigint, left(coalesce(p->>'ubicacion', ''), 120),
          left(coalesce(p->>'resumen', ''), 600), left(coalesce(p->>'historia', ''), 8000), left(coalesce(p->>'mecanica', ''), 6000),
          coalesce(p->'ficha', '[]'::jsonb), coalesce(p->'fotos', '[]'::jsonb),
          left(p->>'vendedor_nombre', 60), p->>'vendedor_slug', coalesce(p->>'vendedor_tipo', 'particular'), left(p->>'telefono', 30), left(coalesce(p->>'email', ''), 160),
          coalesce((p->>'acepta_telefono')::boolean, false))
  returning * into a;
  return jsonb_build_object('ok', true, 'anuncio', jsonb_build_object('id', a.id, 'estado', a.estado, 'tipo', a.tipo, 'titulo', a.titulo, 'nota', a.nota, 'producto', a.producto, 'creado', a.creado));
end $$;

-- Todos los anuncios de un cliente (su perfil): el más reciente primero
create or replace function sidonia_anuncios_mios(p_cliente text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'estado', estado, 'tipo', tipo, 'titulo', titulo, 'precio', precio,
           'nota', nota, 'producto', producto, 'creado', creado, 'portada', fotos->>0) order by creado desc), '[]'::jsonb)
    from anuncios where cliente = p_cliente
$$;

-- Para el panel del equipo
create or replace function sidonia_anuncios_lista(p_estado text default null) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.creado desc), '[]'::jsonb)
    from anuncios a where p_estado is null or a.estado = p_estado
$$;

create or replace function sidonia_anuncio_uno(p_id bigint) returns jsonb language sql stable as $$
  select coalesce((select to_jsonb(a) from anuncios a where id = p_id), 'null'::jsonb)
$$;

create or replace function sidonia_anuncio_estado(p_id bigint, p_estado text, p_nota text default '', p_producto text default null)
returns jsonb language plpgsql as $$
begin
  update anuncios set estado = p_estado, nota = coalesce(p_nota, ''), producto = coalesce(p_producto, producto), actualizado = now()
   where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

-- Clientes que entran en la web con su cuenta (para el panel: quién se registra y quién entra, y cuándo)
create table if not exists clientes (
  cliente   text primary key,                 -- id del cliente de Shopify
  email     text not null default '',
  nombre    text not null default '',
  primera   timestamptz not null default now(),   -- la primera vez que entra (≈ el registro)
  ultima    timestamptz not null default now(),   -- la última vez
  visitas   integer not null default 1            -- veces que ha entrado (una por sesión del navegador)
);
alter table clientes enable row level security;

create or replace function sidonia_visita(p_cliente text, p_email text default '', p_nombre text default '') returns jsonb language plpgsql as $$
declare nuevo boolean;
begin
  insert into clientes (cliente, email, nombre) values (p_cliente, left(coalesce(p_email, ''), 160), left(coalesce(p_nombre, ''), 80))
  on conflict (cliente) do update set
    ultima = now(), visitas = clientes.visitas + 1,
    email = case when excluded.email <> '' then excluded.email else clientes.email end,
    nombre = case when excluded.nombre <> '' then excluded.nombre else clientes.nombre end
  returning (xmax = 0) into nuevo;
  return jsonb_build_object('ok', true, 'nuevo', nuevo);
end $$;

create or replace function sidonia_clientes_lista(p_limite integer default 300) returns jsonb language sql stable as $$
  with hoy as (select (date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid') as d)
  select jsonb_build_object(
    'lista', coalesce((select jsonb_agg(to_jsonb(c) order by c.ultima desc) from (select * from clientes order by ultima desc limit p_limite) c), '[]'::jsonb),
    'total', (select count(*) from clientes),
    'nuevos_hoy', (select count(*) from clientes, hoy where primera >= hoy.d),
    'hoy', (select count(*) from clientes, hoy where ultima >= hoy.d),
    'semana', (select count(*) from clientes where primera >= now() - interval '7 days'))
$$;

-- Cubo de fotos: público para leer (las fichas las enseñan), subir solo con permiso firmado del servidor
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anuncios', 'anuncios', true, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 15728640, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Seguridad: las funciones solo para el servidor (clave de servicio)
revoke execute on all functions in schema public from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end $$;
