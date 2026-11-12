-- SIDONIA · Invitación a un evento para quien puja (lib/invitaciones.mjs). Ejecutar en Supabase › SQL Editor.
-- subasta_invitaciones: el evento de cada subasta (sale de la ficha de Shopify: subasta.invitacion_evento, _fecha,
-- _lugar, _texto). invitaciones_enviadas: a quién se le ha mandado ya (una vez por persona y subasta).
create table if not exists subasta_invitaciones (
  handle      text primary key,
  titulo      text,
  evento      text not null,
  fecha       text,
  lugar       text,
  texto       text,
  actualizado timestamptz not null default now()
);

create table if not exists invitaciones_enviadas (
  handle   text not null,
  cliente  text not null,
  email    text,
  enviado  timestamptz not null default now(),
  primary key (handle, cliente)
);

-- Solo el servidor (clave de servicio) lee y escribe
alter table subasta_invitaciones enable row level security;
alter table invitaciones_enviadas enable row level security;
