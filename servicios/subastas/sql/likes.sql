-- SIDONIA · «Me gusta» de profesionales y eventos (los de los coches de alquiler van en garaje_likes, sql/garaje.sql).
-- Uno por persona y cosa. Se puede ejecutar varias veces.
create table if not exists likes (
  tipo    text not null check (tipo in ('pro','evento')),
  ref     text not null,                 -- el identificador del profesional o del evento en la web
  cliente text not null,                 -- id del cliente de Shopify
  creado  timestamptz not null default now(),
  primary key (tipo, ref, cliente)
);
create index if not exists likes_tipo on likes (tipo, ref);
alter table likes enable row level security;
notify pgrst, 'reload schema';
