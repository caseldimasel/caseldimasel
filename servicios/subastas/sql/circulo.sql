-- SIDONIA · Círculo: anuncios que publica la comunidad (coches, barcos y casas), revisados por Sidonia.
--
-- Cada cliente de Shopify (con su sesión iniciada) puede tener UN anuncio activo gratis: en revisión, aprobado o
-- publicado. Si se lo rechazamos o lo retira, puede enviar otro. Las fotos van a Supabase Storage (cubo «anuncios»,
-- público para leer; solo el servidor da permisos para subir).
--
-- Estados: pendiente → aprobado → publicado (ficha creada en Shopify) · rechazado · retirado.
-- Pégalo en Supabase › SQL Editor y ejecútalo (se puede repetir sin problema).

create table if not exists anuncios (
  id                bigserial primary key,
  cliente           text not null,                         -- id del cliente de Shopify
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente', 'aprobado', 'rechazado', 'publicado', 'retirado')),
  tipo              text not null check (tipo in ('coche', 'barco', 'casa')),
  titulo            text not null,
  precio            bigint,                                -- euros; null = a consultar
  ubicacion         text not null default '',
  resumen           text not null default '',              -- descripción breve
  historia          text not null default '',              -- su historia
  mecanica          text not null default '',              -- descripción mecánica / estado
  ficha             jsonb not null default '[]'::jsonb,    -- [["Año","1967"], ["Kilometraje","82.000 km"], …]
  fotos             jsonb not null default '[]'::jsonb,    -- rutas en el cubo «anuncios», la primera es la portada
  vendedor_nombre   text not null,                         -- el nombre que se enseña: «Enrique»
  vendedor_slug     text not null,                         -- su perfil: /collections/circulo/vendedor-<slug>
  telefono          text not null,
  email             text not null default '',
  acepta_telefono   boolean not null default false,        -- ha aceptado que se vea su teléfono en el anuncio
  nota              text not null default '',              -- nota del equipo (por qué se rechaza…)
  producto          text not null default '',              -- handle del producto en Shopify, al publicarlo
  creado            timestamptz not null default now(),
  actualizado       timestamptz not null default now()
);

-- Un anuncio activo por persona (gratis): la base de datos no deja tener dos a la vez
create unique index if not exists anuncios_uno_activo on anuncios (cliente)
  where estado in ('pendiente', 'aprobado', 'publicado');
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
  if exists (select 1 from anuncios where cliente = p_cliente and estado in ('pendiente', 'aprobado', 'publicado')) then
    return jsonb_build_object('ok', false, 'error', 'limite', 'anuncio', sidonia_anuncio_mio(p_cliente));
  end if;
  insert into anuncios (cliente, tipo, titulo, precio, ubicacion, resumen, historia, mecanica, ficha, fotos,
                        vendedor_nombre, vendedor_slug, telefono, email, acepta_telefono)
  values (p_cliente, p->>'tipo', left(p->>'titulo', 120), nullif(p->>'precio', '')::bigint, left(coalesce(p->>'ubicacion', ''), 120),
          left(coalesce(p->>'resumen', ''), 600), left(coalesce(p->>'historia', ''), 8000), left(coalesce(p->>'mecanica', ''), 6000),
          coalesce(p->'ficha', '[]'::jsonb), coalesce(p->'fotos', '[]'::jsonb),
          left(p->>'vendedor_nombre', 60), p->>'vendedor_slug', left(p->>'telefono', 30), left(coalesce(p->>'email', ''), 160),
          coalesce((p->>'acepta_telefono')::boolean, false))
  returning * into a;
  return jsonb_build_object('ok', true, 'anuncio', sidonia_anuncio_mio(p_cliente));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'limite', 'anuncio', sidonia_anuncio_mio(p_cliente));
end $$;

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
