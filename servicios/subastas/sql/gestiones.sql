-- SIDONIA · Gestiones de venta («Te ayudamos a venderlo», lib/venta.mjs y lib/solicitudes.mjs): cada solicitud que llega
-- desde la web (o que se añade a mano en el panel) con sus datos, su estado y una nota del equipo.
-- Se puede ejecutar varias veces.
create table if not exists gestiones (
  id          bigserial primary key,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  cliente     text not null default '',                 -- id del cliente de Shopify (vacío si se añadió a mano)
  estado      text not null default 'nueva' check (estado in ('nueva', 'contactado', 'en_gestion', 'vendido', 'descartada')),
  datos       jsonb not null default '{}'::jsonb,       -- fotos, marca, modelo, año, km, precio, dónde, historia, ficha, nombre, teléfono, email
  nota        text not null default ''
);
create index if not exists gestiones_estado on gestiones (estado, creado desc);
alter table gestiones enable row level security;
notify pgrst, 'reload schema';
