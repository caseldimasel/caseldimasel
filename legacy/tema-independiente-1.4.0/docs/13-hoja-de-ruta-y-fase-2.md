# 13 · Hoja de ruta y fase 2

El proceso de Sidonia es **seleccionado por el equipo**: el propietario solicita, Sidonia decide y publica. No se construye un marketplace multivendedor con altas, pagos, comisiones ni autopublicación.

## Fase 2 propuesta (cada una con su dependencia y coste operativo)

| Mejora | Dependencia | Coste operativo |
|---|---|---|
| Alertas de nuevas piezas según preferencias | Servicio de email (Shopify Email/Klaviyo), registro de preferencias, consentimiento explícito y baja en un clic | Mantener preferencias y el proceso de envío; cumplimiento RGPD |
| Favoritos sincronizados con cuenta | Cuentas de cliente (nuevas cuentas de Shopify) y almacenamiento de servidor (metacampos de cliente o backend) | Gestión de cuentas y soporte |
| Comparador (máx. 3 de la misma categoría) | Solo tema (estado en el navegador) | Bajo |
| Agenda de visitas con disponibilidad real | Calendario con disponibilidad real (Calendly, Cal.com o propio) | Alguien que mantenga la disponibilidad |
| CRM, asignación y seguimiento de solicitudes | CRM + integración (Flow, webhooks o endpoint propio); el repo `mega` ya contiene un CRM básico y un agente de WhatsApp | Backend alojado, credenciales, monitorización |
| Panel privado del propietario (aportar material, ver el proceso) con revisión previa a publicar | Autenticación, almacenamiento privado, moderación | Alto: privacidad, borrado, soporte |
| Subida de archivos de propietarios | Almacenamiento privado + validación de tamaño, cantidad y tipo en servidor, limitación de abuso, borrado | Medio-alto |
| Métricas de comunidad automáticas | APIs oficiales de cada red (permisos y revisión) | Mantenimiento de tokens y cambios de API |
| Búsqueda por lenguaje natural | Servicio de búsqueda semántica o embeddings sobre las historias | Coste por consulta e indexación |
| Rango numérico real en filtros | Filtro nativo de precio con precio de variante real, o servicio de búsqueda | Mantener coherencia de datos |

## Mantenimiento previsto

- Revisar bandas de filtro al cargar piezas nuevas (`tools/compute-bands.mjs`).
- Pasar `node tools/validate-theme.mjs` y las pruebas (`tools/tests`) antes de cada entrega.
- Regenerar plantillas con `node tools/generate-templates.mjs` si cambian los bloques por defecto.
- Regenerar el idioma con `node tools/build-locale.mjs` tras editar `tools/locale/es.flat.txt`.
