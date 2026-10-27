-- SIDONIA · «¿Quieres que lo vendamos nosotros?» (lib/gestion.mjs): de anuncio de la comunidad a gestión de venta.
-- ofrecida_gestion: cuándo le llegó el email (a los 14 días de publicarlo, una sola vez).
-- quiere_gestion: cuándo pulsó «Sí, quiero que lo vendáis» (sale en el panel y le llega un email al equipo).
-- Se puede ejecutar varias veces.
alter table anuncios add column if not exists ofrecida_gestion timestamptz;
alter table anuncios add column if not exists quiere_gestion timestamptz;
notify pgrst, 'reload schema';
