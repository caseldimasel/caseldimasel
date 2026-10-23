# 14 · Registro de cambios y archivos

> Generado por `node tools/build-docs.mjs`. El detalle exacto de cada integración (archivos creados, reemplazados y
> modificados, con notas) lo escribe `apply-kit` en `impact/sidonia.CAMBIOS.md`, y las diferencias línea a línea en
> `impact/sidonia.diff` (locales: contienen fragmentos de Impact y no se suben al repositorio público).

## Resumen de la integración en Impact 7.2.0

| Tipo | Cantidad | Detalle |
|---|---|---|
| Archivos nuevos del kit (`sidonia-*`) | 69 | assets, secciones, snippets y `snippets/sidonia-impact-bridge.liquid` |
| Plantillas nuevas | 15 | colecciones, fichas, páginas y la vista `product.sidonia-card` |
| Plantillas reemplazadas (con las originales dentro, desactivadas) | 3 | `index.json`, `search.json`, `404.json` |
| Archivos de Impact modificados | 13 | ver [15](15-restaurar-y-actualizar-impact.md) |
| `config/settings_data.json` | 0 | **sin cambios** |
| Resto de archivos de Impact | sin cambios | — |

## Decisiones registradas

| Decisión | Motivo |
|---|---|
| Kit con prefijo `sidonia-` + parches con anclas exactas | Trazable, reversible y sin inventar APIs de Impact |
| Cabecera transparente nativa de Impact | Evitar un segundo sistema; Impact ya la resuelve con `allow-transparent-header` |
| Cabecera fija y logo a la izquierda en el duplicado | Estado piedra al superar el hero; disposición de JamesEdition; menú en una línea |
| Paleta piedra por puente de variables con casilla | No tocar `settings_data.json` y poder volver atrás |
| `page.sidonia-about` en lugar de `page.about` | La tienda ya usa `page.about` |
| Portada, búsqueda y 404 del kit con las secciones originales desactivadas | No perder contenido de la tienda |
| Búsqueda con `sidonia-catalog` (piezas y productos normales) | Precio editorial de las piezas y filtros de Sidonia; los productos normales con su precio |
| Tarjeta y precio Sidonia dentro de componentes de Impact solo si `sidonia.category` | Comercio normal intacto |
| Ofertas en JSON-LD solo con precio publicado y disponible | Nunca una oferta comprable con precio 0 |
| Formulario de contacto nativo | Sin servidor ni credenciales en la primera versión |

## Parches de Impact

| Parche | Qué hace |
|---|---|
| `integration/patches/10-impact-header.mjs` | Impact 7.x · cabecera (sections/header.liquid) y panel de navegación móvil (snippets/navigation-panel.liquid). |
| `integration/patches/20-impact-commerce.mjs` | Impact 7.x · piezas Sidonia dentro de los componentes de Impact. |
| `integration/patches/30-impact-seo.mjs` | Impact 7.x · SEO de las piezas Sidonia. |
| `integration/patches/40-impact-bridge.mjs` | Impact 7.x · puente de medidas y paleta (integration/impact/snippets/sidonia-impact-bridge.liquid). |
| `integration/patches/50-impact-templates.mjs` | Impact 7.x · plantillas y grupos de secciones del duplicado. |
| `integration/patches/_lib.mjs` | Utilidades comunes de los parches de Impact. |

## Archivos del kit

| Archivo | Para qué sirve |
|---|---|
| `kit/assets/sidonia-base.css` | ========================================================================== SIDONIA · base del kit para Impact Tokens, primitivas y componentes compartidos. |
| `kit/assets/sidonia-catalog.js` | SIDONIA · catálogo: |
| `kit/assets/sidonia-core.js` | SIDONIA · núcleo del kit para Impact Sin dependencias ni paso de build. |
| `kit/assets/sidonia-forms.js` | SIDONIA · formularios (consulta de pieza, contacto, «qué buscas» y solicitud de venta) Mejora progresiva sobre el formulario de contacto NATIVO de Shopify ({% form 'contact' %}): |
| `kit/assets/sidonia-product.js` | SIDONIA · ficha de pieza - Barra de contacto fija en móvil: |
| `kit/assets/sidonia-sections.css` | ========================================================================== SIDONIA · secciones del kit Mobile-first. |
| `kit/assets/sidonia-video.js` | SIDONIA · vídeo Reglas (briefing §12): |
| `kit/sections/sidonia-catalog.liquid` | SIDONIA · Catálogo con filtros (colecciones y búsqueda). |
| `kit/sections/sidonia-community.liquid` | SIDONIA · Confianza y comunidad. |
| `kit/sections/sidonia-contact-form.liquid` | SIDONIA · Formulario general (formulario de contacto nativo de Shopify) en dos modos: |
| `kit/sections/sidonia-criteria.liquid` | SIDONIA · Criterio de selección: |
| `kit/sections/sidonia-divisions.liquid` | SIDONIA · Tres mundos, una misma selección. |
| `kit/sections/sidonia-faq.liquid` | SIDONIA · Preguntas frecuentes (generales y por categoría). |
| `kit/sections/sidonia-favorites.liquid` | SIDONIA · Favoritos (guardados en este navegador, sin cuenta). |
| `kit/sections/sidonia-footer-band.liquid` | SIDONIA · Franja de pie: |
| `kit/sections/sidonia-hero.liquid` | SIDONIA · Hero con promesa, vídeo bajo demanda y búsqueda real. |
| `kit/sections/sidonia-how-we-sell.liquid` | SIDONIA · Cómo vendemos (pasos). |
| `kit/sections/sidonia-listing-details.liquid` | SIDONIA · Estado, trabajos realizados y documentos públicos (si se conocen). |
| `kit/sections/sidonia-listing-inquiry.liquid` | SIDONIA · Formulario de consulta de una pieza (formulario de contacto nativo de Shopify). |
| `kit/sections/sidonia-listing-related.liquid` | SIDONIA · Piezas relacionadas, de forma explicable: |
| `kit/sections/sidonia-listing-specs.liquid` | SIDONIA · Ficha técnica agrupada según la categoría. |
| `kit/sections/sidonia-listing-story.liquid` | SIDONIA · La historia de la pieza, qué la hace especial, el propietario (si lo autoriza) y la transcripción del vídeo como vía adicional de acceso (no sustituye al vídeo). |
| `kit/sections/sidonia-listing-timeline.liquid` | SIDONIA · Cronología breve basada en fechas reales (metaobjeto sidonia_timeline_event, referenciado desde el metacampo sidonia.timeline). |
| `kit/sections/sidonia-listing.liquid` | SIDONIA · Ficha de pieza (sección principal). |
| `kit/sections/sidonia-listings.liquid` | SIDONIA · Selección de piezas (4 a 8), desde una colección o una lista manual de productos. |
| `kit/sections/sidonia-not-found.liquid` | SIDONIA · Página 404 útil: |
| `kit/sections/sidonia-owner-cta.liquid` | SIDONIA · Llamada a propietarios. |
| `kit/sections/sidonia-page-header.liquid` | SIDONIA · Cabecera de página (Cómo vendemos, Sobre Sidonia, Vender, Contacto, Favoritos…). |
| `kit/sections/sidonia-sell-form.liquid` | SIDONIA · Formulario ÚNICO de solicitud de venta para Coches, Barcos y Casas. |
| `kit/sections/sidonia-story.liquid` | SIDONIA · Una historia concreta: |
| `kit/sections/sidonia-testimonials.liquid` | SIDONIA · Testimonios y casos. |
| `kit/snippets/sidonia-amount.liquid` | Importe público con su moneda, sin conversión ni decimales: |
| `kit/snippets/sidonia-body-end.liquid` | SIDONIA · se renderiza UNA vez en layout/theme.liquid, justo antes de </body> (lo inserta integration/apply-kit.mjs entre marcas <!-- sidonia:body -->). |
| `kit/snippets/sidonia-breadcrumbs.liquid` | Migas de pan accesibles y su versión en datos estructurados (BreadcrumbList). |
| `kit/snippets/sidonia-card.liquid` | Tarjeta de pieza (catálogo, búsqueda, selección, relacionadas y favoritos). |
| `kit/snippets/sidonia-cat-label.liquid` | Nombre público de una categoría con su punto de color. |
| `kit/snippets/sidonia-catalog-body.liquid` | Cuerpo común del catálogo (colección y búsqueda): |
| `kit/snippets/sidonia-category.liquid` | Clave interna de la categoría de una pieza (garage, harbor, estate…) o nada si no consta. |
| `kit/snippets/sidonia-contact-actions.liquid` | Acciones de contacto de una ficha: |
| `kit/snippets/sidonia-contact-link.liquid` | Enlace de contacto (WhatsApp, correo o teléfono). |
| `kit/snippets/sidonia-division-keys.liquid` | Claves internas de las categorías activas, separadas por comas y en el orden en que se muestran. |
| `kit/snippets/sidonia-division.liquid` | Datos de una categoría (división) desde Ajustes del tema > Sidonia · Categorías. |
| `kit/snippets/sidonia-duration.liquid` | Duración «m:ss» solo si se conoce (nunca se inventa). |
| `kit/snippets/sidonia-facets-active.liquid` | Chips de filtros activos (enlaces reales para quitar cada uno) y «Limpiar todo». |
| `kit/snippets/sidonia-facets.liquid` | Grupos de filtros de Shopify / Search & Discovery (results.filters). |
| `kit/snippets/sidonia-field.liquid` | Campo de formulario accesible: |
| `kit/snippets/sidonia-form-status.liquid` | Estado real de un formulario nativo de Shopify: |
| `kit/snippets/sidonia-head.liquid` | SIDONIA · se renderiza UNA vez en layout/theme.liquid, justo antes de </head> (lo inserta integration/apply-kit.mjs entre marcas <!-- sidonia:head -->). |
| `kit/snippets/sidonia-header-actions.liquid` | Acciones Sidonia para la cabecera: |
| `kit/snippets/sidonia-icon.liquid` | Iconos funcionales de interfaz (trazo, rejilla 24×24). |
| `kit/snippets/sidonia-image.liquid` | Imagen adaptable (srcset con image_url) con dimensiones reservadas y punto focal nativo de Shopify (image.presentation.focal_point, editable en el administrador al recortar la imag |
| `kit/snippets/sidonia-location.liquid` | Ubicación ACTUAL y pública de una pieza, según la precisión autorizada (metacampo sidonia.location_precision). |
| `kit/snippets/sidonia-menu-dot.liquid` | Punto de categoría para un enlace de menú. |
| `kit/snippets/sidonia-number.liquid` | Número con separadores de español de España. |
| `kit/snippets/sidonia-owner.liquid` | Presentación pública del propietario. |
| `kit/snippets/sidonia-pagination.liquid` | Paginación real con enlaces (funciona sin JavaScript y conserva filtros y orden en la URL). |
| `kit/snippets/sidonia-player.liquid` | Reproductor de la ficha (y de «Una historia concreta»). |
| `kit/snippets/sidonia-price.liquid` | Precio editorial de una pieza. |
| `kit/snippets/sidonia-save.liquid` | Botón «Guardar» (favoritos anónimos de este navegador). |
| `kit/snippets/sidonia-sell-fields.liquid` | Campos del paso 2 del formulario de venta según la categoría. |
| `kit/snippets/sidonia-social.liquid` | Cuentas sociales de Sidonia. |
| `kit/snippets/sidonia-sort.liquid` | Ordenación. |
| `kit/snippets/sidonia-spec.liquid` | Un dato técnico de una pieza, ya formateado. |
| `kit/snippets/sidonia-specs.liquid` | Datos esenciales de una pieza según su categoría. |
| `kit/snippets/sidonia-status.liquid` | Estado editorial de una pieza. |
| `kit/snippets/sidonia-structured-data.liquid` | Datos estructurados (JSON-LD) de una pieza. |
| `kit/snippets/sidonia-url.liquid` | URL de una página o colección clave, sin llevar nunca a un 404 en una tienda a medio configurar. |
| `kit/snippets/sidonia-video-attrs.liquid` | Atributos data-* para reproducir el vídeo de una pieza BAJO DEMANDA (al pulsar). |
| `kit/templates/404.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/collection.estate.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/collection.garage.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/collection.harbor.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/collection.sidonia.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/collection.sold.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/index.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/page.favorites.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/page.how-it-works.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/page.sell.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/page.sidonia-about.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/page.sidonia-contact.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/page.wanted.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/product.estate.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/product.garage.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/product.harbor.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/templates/product.sidonia-card.liquid` | Vista alternativa de producto para la página de Favoritos: |
| `kit/templates/search.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/locales/es.json` | Plantilla generada por tools/build-templates.mjs |
| `kit/config/settings_schema.sidonia.json` | Plantilla generada por tools/build-templates.mjs |

## Herramientas

| Archivo | Para qué sirve |
|---|---|
| `integration/audit-impact.mjs` |  |
| `integration/apply-kit.mjs` |  |
| `integration/build-zip.mjs` |  |
| `integration/lib.mjs` | Utilidades compartidas por los scripts de integración (sin dependencias). |
| `integration/impact/snippets/sidonia-impact-bridge.liquid` | SIDONIA · puente con Impact 7.x (lo instala integration/patches/40-impact-bridge.mjs; NO es un archivo de Impact). |
| `tools/check-kit.mjs` |  |
| `tools/lint/liquid.mjs` |  |
| `tools/lint/schema.mjs` |  |
| `tools/contrast.mjs` | Calcula ratios de contraste WCAG 2.x entre pares de colores. |
| `tools/palette.mjs` | Paleta Sidonia y pares que deben cumplir contraste (WCAG 2.2 AA). |
| `tools/build-templates.mjs` | Genera las plantillas JSON del kit (kit/templates/*.json) a partir de una única definición. |
| `tools/build-docs.mjs` |  |
| `tools/setup/provision.mjs` |  |
| `tools/harness/server.mjs` | Servidor del ARNÉS DE PRUEBAS (no es Shopify ni Impact). |
| `tools/harness/liquid.mjs` | Intérprete mínimo de Liquid para PRUEBAS del tema de Sidonia. |
| `tools/harness/store.mjs` | Datos de PRUEBA del arnés. |
| `tools/harness/tests/e2e.mjs` | Pruebas end-to-end de SIDONIA en Chromium, con datos [PRUEBA] y el intérprete de Liquid del arnés. |
| `tools/harness/tests/report.mjs` |  |
| `tools/harness/screenshots.mjs` |  |
