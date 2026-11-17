-- SIDONIA · Facturas emitidas (panel › Ventas › Facturas, lib/facturas.mjs). Se puede ejecutar varias veces.
-- Cada factura con su cliente, su concepto, la base, el IVA y el total; si es de una venta, enlazada con ella.
create table if not exists facturas (
  id            bigserial primary key,
  creado        timestamptz not null default now(),
  numero        text not null unique,          -- «2026-001»
  fecha         date not null,
  cliente       text not null default '',
  nif           text not null default '',
  concepto      text not null default '',
  base          numeric(12, 2) not null default 0,
  iva           numeric(12, 2) not null default 0,
  total         numeric(12, 2) not null default 0,
  operacion_id  bigint,                         -- la venta (tabla operaciones), si es de una venta
  notas         text not null default ''
);
create index if not exists facturas_fecha on facturas (fecha desc);
alter table facturas enable row level security;
notify pgrst, 'reload schema';
