# 00 · Decisiones, supuestos y trazabilidad del briefing

## Resumen de decisiones esenciales

1. **Tema propio desde cero**, sin base de terceros ni código de Impact: Liquid, plantillas JSON, CSS y JavaScript sin paso de build. No hay licencia ajena que conservar.
2. **Las piezas son productos de Shopify** con metacampos del propietario de la tienda en el namespace `sidonia`. Solo la cronología usa un metaobjeto.
3. **Estado editorial independiente del inventario**: Disponible, Reservado y Vendido salen de un metacampo; las piezas no son comprables (inventario 0, sin seguir vendiendo).
4. **El precio visible sale de metacampos** (modo + importe). El tema nunca imprime el precio de la variante ni un 0.
5. **Filtros nativos de Search & Discovery**; los rangos se resuelven con **bandas de texto** porque un metacampo numérico no da un rango libre.
6. **Filtro, orden y paginación reales** (Section Rendering API) con **estado en la URL**; sin JavaScript funcionan como formularios y enlaces.
7. **Vídeo bajo demanda**: las tarjetas llevan portada y botón; el `<video>` se crea al pulsar, en un modal nativo. Nunca hay audio automático y solo suena uno a la vez.
8. **Favoritos locales** (sin cuenta) que se revalidan al abrir con `?view=card`, una vista alternativa soportada de Shopify.
9. **Formularios con el contacto nativo de Shopify**, mejorados con `fetch`; el éxito se decide por la respuesta real. Sin subida de archivos: solo un enlace.
10. **Tipografía de sistema por defecto** (serif editorial + sans), con opción de la biblioteca de fuentes de Shopify; ningún archivo de fuente externo.
11. **Colores de división editables**; si no alcanzan 4,5:1 como texto, el tema los oscurece solo.
12. **Divisiones como datos**: añadir una categoría es una lista y unos ajustes, no una reescritura de la navegación.
13. **Lo que no se puede garantizar sin Shopify se declara**: ver `09-informe-de-pruebas.md`.

## Supuestos declarados

- Tienda en español de España, una sola moneda para precios editoriales (EUR por defecto), sin selector de idioma.
- Operación de **catálogo y generación de contactos**: sin carrito, financiación, depósitos, subastas, reservas de pago ni comisiones.
- Nombre de la marca madre **SIDONIA** y divisiones **SIDONIA GARAGE / HARBOR / ESTATE** (se conserva exactamente HARBOR).
- El tema se publica **solo cuando lo decida Sidonia**; el tema actual (Impact) no se toca.
- Los logos, el isotipo, los datos de contacto, las cifras de redes, los vídeos y los anuncios reales los aporta Sidonia (`11-datos-pendientes.md`).
- Las condiciones legales, tarifas, exclusividades, plazos y alcance de la intermediación **no se han redactado**: no se prometen.

## Trazabilidad del briefing

| § | Tema | Estado | Dónde |
|---|---|---|---|
| 1 | Qué es Sidonia, «alma», no afirmar inspecciones ni garantías | Cumplido | Textos por defecto sin esas afirmaciones; `listing.*`, `product.facts_note` |
| 2 | Arquitectura de marca, logos editables, texto de reserva, categorías futuras | Cumplido (logos los aporta Sidonia) | `01`, `settings_schema.json`, `division-keys` |
| 3 | Dos recorridos, objetivos | Cumplido | Home, ficha, `page.sell` |
| 4 | Tema independiente, sin publicar | Cumplido | `02`; sin base de terceros |
| 4 | Consultar documentación vigente de Shopify | **No cumplido** (red bloqueada) | `09` §2 y §5 |
| 5–6 | Dirección creativa, sistema de diseño, ajustes útiles | Cumplido | `sd-base.css`, `css-variables`, `settings_schema.json` |
| 6 | Localización | Cumplido (cadenas en `locales`) | Sin selector de idioma |
| 7 | Navegación y mapa de páginas | Cumplido; Impact/redirecciones: por hacer en tienda | `02` |
| 8.1–8.11 | Home completa | Cumplido | `sections/` y `index.json` |
| 9 | Catálogo y tarjetas | Cumplido | `listing-card`, `main-collection` |
| 10 | Buscador y filtros reales | Cumplido en el tema; configuración en Shopify pendiente | `04` |
| 11 | Ficha de anuncio | Cumplido | `main-product`, `product-*` |
| 12 | Vídeo | Cumplido en el tema; límites de Shopify por verificar | `07` |
| 13 | Contactar (WhatsApp, email, formulario) | Cumplido; recepción por probar | `08` |
| 14 | Formulario de propietarios | Cumplido; reparto de leads y subida de archivos **no implementados** | `08` |
| 15 | Favoritos | Cumplido | `sd-favorites.js` |
| 16 | Modelo de datos | Cumplido (definiciones por crear en el administrador) | `03` |
| 17 | Precio, disponibilidad, bloqueo de compra | Cumplido en el tema; bloqueo **por probar** | `05` |
| 18 | Funciones adicionales | Compartir, relacionadas, archivo, «algo parecido», FAQ por categoría, idioma de vídeo, «qué buscas» cumplidos; fase 2 documentada | `13` |
| 19 | Rendimiento y accesibilidad | Diseñado y medido en local; **LCP/INP y lector de pantalla sin medir** | `09` |
| 20 | SEO y analítica | Cumplido | `seo-meta`, `structured-listing`, `sd-analytics.js` |
| 21 | Estructura y compatibilidad con el editor | Cumplido en el tema; prueba en el editor real pendiente | `09` §6 |
| 22 | Contenido de demostración | Instalación vacía cuidada; fixtures solo en `tools/` | `tools/preview/store.mjs` |
| 23–24 | Fases y entregables | Entregados los 11 | `README.md` |
| 25 | Pruebas de aceptación | Ver `09`: las que dependen de Shopify real constan como pendientes | `09` |
| 26 | Criterio de calidad | Revisión visual y funcional local | — |

## Estado para continuar el proyecto

**Terminado:** tema completo (35 secciones, 40 snippets, 11 assets, 26 plantillas, 357 cadenas), validador, intérprete y servidor de previsualización, 66 pruebas end-to-end, bandas, ZIP y documentación.

**Pendiente (requiere Shopify o decisiones de Sidonia):** subir el ZIP y ejecutar Theme Check; crear definiciones, colecciones, filtros, páginas y menús; probar recepción de formularios y bloqueo de compra; verificar los hechos del apartado 5 de `09`; cargar contenido real; accesibilidad con lector de pantalla y Lighthouse; decisiones legales.

**Cómo retomar:** `node tools/validate-theme.mjs` → `node tools/tests/e2e.mjs` → editar → `node tools/generate-templates.mjs` / `node tools/build-locale.mjs` si procede → `node tools/build-zip.mjs`.
