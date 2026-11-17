-- SIDONIA · Gastos de Sidonia (panel › Ventas › Gastos, lib/gastos.mjs). Se puede ejecutar varias veces.
--   cuota: lo que se paga cada mes (suscripciones): importe al mes, desde (fecha) y, si se dejó, hasta
--   cargo: un cargo real del extracto (ManyChat, Shopify, gasolina…), con su fecha y su importe
-- Cada mes, si un concepto tiene cargos reales, cuentan esos; si no, su cuota.
create table if not exists gastos (
  id          bigserial primary key,
  creado      timestamptz not null default now(),
  tipo        text not null check (tipo in ('cuota', 'cargo')),
  concepto    text not null,
  categoria   text not null default 'Otros',
  importe     numeric(12, 2) not null check (importe >= 0),
  fecha       date not null,                 -- cargo: el día; cuota: desde cuándo
  hasta       date,                          -- cuota: hasta cuándo (vacío: sigue)
  variable    boolean not null default false, -- cuota que cambia cada mes (ManyChat): el importe es una estimación
  notas       text not null default ''
);
create index if not exists gastos_fecha on gastos (fecha desc);
alter table gastos enable row level security;
notify pgrst, 'reload schema';
