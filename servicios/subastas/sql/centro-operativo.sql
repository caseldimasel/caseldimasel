-- SIDONIA · Centro operativo y Finanzas: todo lo que necesita el panel para los gastos, las facturas, el expediente de
-- cada coche (contrato de intermediación, venta, factura y cobro) y los datos de facturación. Se puede ejecutar varias
-- veces, entero: crea lo que falte y no toca lo que ya hay. Necesita sql/operaciones.sql (la tabla de ventas).

-- Gastos de Sidonia (lib/gastos.mjs)
create table if not exists gastos (
  id bigserial primary key, creado timestamptz not null default now(),
  tipo text not null check (tipo in ('cuota', 'cargo')), concepto text not null, categoria text not null default 'Otros',
  importe numeric(12, 2) not null check (importe >= 0), fecha date not null, hasta date,
  variable boolean not null default false, notas text not null default ''
);
create index if not exists gastos_fecha on gastos (fecha desc);
alter table gastos enable row level security;

-- Facturas emitidas (lib/facturas.mjs y lib/expedientes.mjs)
create table if not exists facturas (
  id bigserial primary key, creado timestamptz not null default now(),
  numero text not null unique, fecha date not null, cliente text not null default '', nif text not null default '',
  concepto text not null default '', base numeric(12, 2) not null default 0, iva numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0, operacion_id bigint, notas text not null default ''
);
alter table facturas add column if not exists estado text not null default 'emitida';     -- emitida · anulada
alter table facturas add column if not exists forma_pago text not null default '';         -- transferencia · bizum · tarjeta · efectivo
alter table facturas add column if not exists cobrada date;                                -- cuándo se cobró
alter table facturas add column if not exists datos jsonb not null default '{}'::jsonb;    -- a nombre de quién, %, precio de venta, emisor, envíos
create index if not exists facturas_fecha on facturas (fecha desc);
alter table facturas enable row level security;

-- El expediente de cada coche, en su venta (lib/expedientes.mjs)
alter table operaciones add column if not exists expediente jsonb not null default '{}'::jsonb;

-- Ajustes (los datos de facturación: clave «facturacion»)
create table if not exists ajustes (clave text primary key, valor jsonb not null default '{}'::jsonb, actualizado timestamptz not null default now());
alter table ajustes enable row level security;

notify pgrst, 'reload schema';
