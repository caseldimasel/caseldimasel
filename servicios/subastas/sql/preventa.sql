-- SIDONIA · Reservas sin cobro (preventa) de la SIDONIA RD10 (lib/preventa.mjs). Ejecutar en Supabase › SQL Editor.
-- estado: pendiente (no guardó la tarjeta) · reservada · cancelada · cobrada
create table if not exists preventas (
  id            bigserial primary key,
  token         text unique not null,
  producto      text not null,
  nombre        text not null,
  email         text not null,
  telefono      text,
  cantidad      int not null default 1,
  precio        numeric(10,2) not null,
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'reservada', 'cancelada', 'cobrada')),
  stripe_cliente text,
  metodo_pago   text,
  tarjeta       text,
  volver        text,
  creado        timestamptz not null default now(),
  reservado     timestamptz,
  cancelado     timestamptz
);
create index if not exists preventas_producto on preventas (producto, estado);
create index if not exists preventas_email on preventas (email);
alter table preventas enable row level security;
