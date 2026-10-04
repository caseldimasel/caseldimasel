# 12 · Registro de archivos

Generado con `node tools/list-files.mjs`. La carpeta `theme/` es lo único que se sube a Shopify (el ZIP `dist/sidonia-theme-<versión>.zip` contiene su contenido en la raíz).

## Estructura del repositorio

| Carpeta | Contenido | ¿Va en el ZIP? |
|---|---|---|
| `theme/` | El tema: `layout`, `templates`, `sections`, `snippets`, `assets`, `config`, `locales` | **Sí** |
| `docs/` | Documentación en español | No |
| `tools/` | Validador, generadores, intérprete y servidor de previsualización, pruebas, bandas | No |
| `dist/` | ZIP generado y su suma SHA-256 | — |

## Raíz del tema

| Archivo | Para qué sirve |
|---|---|
| `layout/theme.liquid` | Estructura HTML, cabecera/pie por grupos de secciones, scripts, `content_for_header` y `content_for_layout` |
| `layout/password.liquid` | Página de contraseña (para previsualizar sin publicar) |
| `config/settings_schema.json` | Ajustes globales editables (2 archivos en `config`) |
| `config/settings_data.json` | Valores por defecto (vacío: se aplican los del schema) |
| `locales/es.default.json` | Todas las cadenas de interfaz (español de España) |
| `sections/header-group.json`, `footer-group.json` | Grupos de secciones de cabecera y pie |

## Plantillas (`templates/`)

`404.json` · `article.json` · `blog.json` · `cart.json` · `collection.archive.json` · `collection.barcos.json` · `collection.casas.json` · `collection.coches.json` · `collection.json` · `index.json` · `list-collections.json` · `page.about.json` · `page.brands.json` · `page.contact.json` · `page.favorites.json` · `page.how-it-works.json` · `page.json` · `page.legal.json` · `page.sell.json` · `page.wanted.json` · `password.json` · `product.barcos.json` · `product.card.liquid` · `product.casas.json` · `product.coches.json` · `product.json` · `search.json`

Las plantillas JSON se generan con `node tools/generate-templates.mjs`. `product.card.liquid` es la vista alternativa que usa Favoritos.

## Secciones (`sections/`)

| Archivo | Nombre en el editor |
|---|---|
| `brand-directory.liquid` | Marcas |
| `community.liquid` | Confianza y comunidad |
| `divisions.liquid` | Tres mundos |
| `faq.liquid` | Preguntas frecuentes |
| `featured-listings.liquid` | Selección de piezas |
| `featured-story.liquid` | Una historia concreta |
| `footer.liquid` | Pie de página |
| `header.liquid` | Cabecera |
| `hero.liquid` | Hero con vídeo |
| `how-we-sell.liquid` | Cómo vendemos |
| `main-404.liquid` | Página 404 |
| `main-article.liquid` | Artículo |
| `main-blog.liquid` | Blog |
| `main-cart.liquid` | Carrito (sin compra) |
| `main-collection.liquid` | Colección con filtros |
| `main-contact.liquid` | Contacto |
| `main-favorites.liquid` | Favoritos |
| `main-list-collections.liquid` | Lista de colecciones |
| `main-page.liquid` | Contenido de la página |
| `main-password.liquid` | Página de contraseña |
| `main-product.liquid` | Ficha de pieza |
| `main-search.liquid` | Resultados de búsqueda |
| `owner-cta.liquid` | Llamada a propietarios |
| `page-header.liquid` | Cabecera de página |
| `photo-story.liquid` | Galería de fotos |
| `predictive-search.liquid` | Búsqueda predictiva |
| `product-inquiry.liquid` | Formulario de consulta |
| `product-specs.liquid` | Datos técnicos |
| `product-story.liquid` | Historia de la pieza |
| `product-timeline.liquid` | Cronología |
| `related-listings.liquid` | Piezas relacionadas |
| `rich-text.liquid` | Texto |
| `selection-criteria.liquid` | Criterio de selección |
| `sell-form.liquid` | Formulario propietarios |
| `team.liquid` | Equipo |
| `testimonials.liquid` | Testimonios y casos |
| `wanted-form.liquid` | Cuéntanos qué buscas |

## Snippets (`snippets/`)

| Archivo | Descripción |
|---|---|
| `brand-list.liquid` | Listas de marcas (coches y barcos) separadas por «/». GENERADO por tools/generate-brands.mjs desde tools/brands.json: no editar a mano. |
| `breadcrumbs.liquid` | Migas de pan accesibles. Usa el contexto de plantilla (producto, colección, página). |
| `bundled-photo.liquid` | Fotografía incluida en el tema (theme/assets/foto-*.jpg). Solo se usa donde no hay imagen propia y |
| `color-on.liquid` | Devuelve el color de texto (blanco o tinta) con mejor contraste sobre un relleno. |
| `color-safe.liquid` | Devuelve un color apto como texto sobre el fondo indicado (contraste >= 4,5:1). |
| `contact-actions.liquid` | Acciones de contacto de una ficha: WhatsApp, email, formulario y Guardar/Compartir. |
| `contact-link.liquid` | Construye enlaces de contacto. No emite nada si el canal no está configurado |
| `css-variables.liquid` | Tokens de diseño de Sidonia. Todo el CSS usa estas variables. |
| `division-chips.liquid` | Enlaces rápidos a todas las divisiones activas (<li> con chip de color). Las divisiones salen de snippets/division-keys.liquid. |
| `division-info.liquid` | Datos de una división desde los ajustes del tema. |
| `division-keys.liquid` | Lista (separada por comas) de las divisiones activas. Único sitio que hay que tocar, |
| `facets-active.liquid` | Chips de filtros activos y «Limpiar todo». Parámetros: results, clear_url. |
| `facets-panel.liquid` | Grupos de filtros de Search & Discovery. Parámetros: results (collection o search), uid. |
| `facets-sort.liquid` | Selector de orden. Solo ofrece ordenaciones reales de Shopify: selección editorial (manual), novedades, |
| `fact-row.liquid` | Fila de dato técnico (lista de descripción). Parámetros: label, value. |
| `form-errors.liquid` | Resumen de errores devuelto por Shopify. Parámetros: form, uid. |
| `form-field.liquid` | Campo de formulario con etiqueta, ayuda y mensaje de error asociados. |
| `form-person-fields.liquid` | Datos de contacto de la persona + preferencia de contacto + consentimientos. |
| `format-amount.liquid` | Importe público con símbolo de moneda, sin conversión. Parámetros: amount, currency. |
| `format-number.liquid` | Formatea un número con separador de miles según el idioma. Parámetros: n, decimals (opcional, máx. 2). |
| `icon.liquid` | Iconos de interfaz (trazo 24x24). Parámetros: name, size (px, por defecto 20), class. |
| `js-config.liquid` | Configuración pública para los scripts del tema. No contiene secretos, tokens ni datos personales. |
| `listing-brands.liquid` | Fila de marcas con piezas ahora mismo, tomada del filtro real de marca (coches) o astillero (barcos) de |
| `listing-card.liquid` | Tarjeta de pieza. Reutilizable en colecciones, búsqueda, selección, favoritos y relacionadas. |
| `listing-category.liquid` | Devuelve la categoría de una pieza: garage, harbor o estate (o nada si no consta). |
| `listing-facts.liquid` | Datos técnicos de una pieza como filas <div><dt><dd></div> (dentro de un <dl>). Solo se emiten los datos conocidos: |
| `listing-location.liquid` | Ubicación pública según la precisión elegida (nunca dirección exacta). |
| `listing-price.liquid` | Precio editorial de una pieza. Nunca usa el precio de la variante de Shopify. |
| `listing-segments.liquid` | Pestañas de categoría (Todo · Coches · Barcos · Casas). Parámetro: cat (garage/harbor/estate o vacío). |
| `listing-specs.liquid` | Dos o tres datos técnicos clave por categoría, solo los conocidos. |
| `listing-status.liquid` | Estado editorial: available, reserved o sold (vacío si no consta). |
| `logo.liquid` | Logo de marca. Parámetros: variant ('dark' = para fondos claros, 'light' = para fondos oscuros), class. |
| `page-url.liquid` | URL de una página clave del tema. |
| `pagination-nav.liquid` | Paginación real con enlaces. «Cargar más» es una mejora progresiva (sd-facets.js) que usa la misma URL siguiente. |
| `save-button.liquid` | Botón Guardar (favoritos locales del navegador). Parámetros: product, variant ('card' / 'page'), class. |
| `sd-image.liquid` | Imagen adaptable con srcset, dimensiones reservadas y punto focal. |
| `seo-meta.liquid` | Título, descripción, Open Graph, Twitter y robots. |
| `spec-item.liquid` | Un dato técnico para tarjeta. Parámetros: label, value. |
| `status-chip.liquid` | Estado editorial como chip con texto e icono (no solo color). Parámetro: status. |
| `structured-listing.liquid` | Datos estructurados de una pieza (JSON-LD). Reglas: |
| `video-attrs.liquid` | Atributos data-* con todo lo necesario para reproducir el vídeo de una pieza bajo demanda. |
| `video-best-source.liquid` | Mejor fuente mp4 de un vídeo alojado en Shopify con altura <= max_height (o la más pequeña si todas son mayores). |
| `video-duration.liquid` | Duración mm:ss si se conoce. Parámetro: seconds. |
| `video-modal.liquid` | Reproductor modal único para toda la tienda. Usa <dialog> nativo: |

## Assets (`assets/`)

| Archivo | Tamaño | Descripción |
|---|---|---|
| `foto-alfa-giulia.jpg` | 541.1 KB |  |
| `foto-ford-roadster.jpg` | 621.5 KB |  |
| `foto-jaguar-e-type.jpg` | 483.1 KB |  |
| `foto-maserati-19.jpg` | 495.9 KB |  |
| `foto-maserati-detalle.jpg` | 520.5 KB |  |
| `foto-maserati-lago.jpg` | 465.7 KB |  |
| `foto-porsche-911.jpg` | 644.8 KB |  |
| `kmr-apparat-medium.otf` | 117.0 KB |  |
| `sd-analytics.js` | 4.2 KB | Adaptador de analítica opcional (lista blanca, consentimiento, sin datos personales) |
| `sd-base.css` | 12.9 KB | Reinicio, tipografía, utilidades, botones, chips, formularios, tabla de datos (usa los tokens) |
| `sd-brands.js` | 7.6 KB |  |
| `sd-components.css` | 32.6 KB | Cabecera, menús, cajones, pie, tarjetas, vídeo, filtros, paginación, avisos |
| `sd-core.js` | 5.0 KB | Espacio de nombres, configuración, utilidades, avisos accesibles, diálogos |
| `sd-facets.js` | 12.4 KB | Filtros y orden por AJAX con estado en URL; «Cargar más»; restauración de posición |
| `sd-favorites.js` | 16.0 KB | Favoritos locales, `<sd-save>`, `<sd-fav-count>`, `<sd-favorites-page>` |
| `sd-forms.js` | 15.4 KB | Validación y envío mejorado de formularios; formulario de propietarios en 3 pasos |
| `sd-header.js` | 5.9 KB | Cajón de navegación, buscador y búsqueda predictiva |
| `sd-product.js` | 4.6 KB | Compartir y barra fija de contacto en móvil |
| `sd-sections.css` | 29.9 KB | Hero, secciones de la home, ficha, formularios, contacto, favoritos |
| `sd-video.js` | 17.9 KB | Reproductor modal, reproductor de ficha, previsualización, proveedores externos, un solo audio |
| `sidonia-firma-dark.png` | 24.2 KB |  |
| `sidonia-firma-light.png` | 29.5 KB |  |
| `sidonia-logo-dark.png` | 29.0 KB |  |
| `sidonia-logo-estate-dark.png` | 29.3 KB |  |
| `sidonia-logo-estate-light.png` | 32.8 KB |  |
| `sidonia-logo-garage-dark.png` | 29.2 KB |  |
| `sidonia-logo-garage-light.png` | 32.8 KB |  |
| `sidonia-logo-harbor-dark.png` | 29.3 KB |  |
| `sidonia-logo-harbor-light.png` | 32.8 KB |  |
| `sidonia-logo-light.png` | 32.8 KB |  |
| `sidonia-punto.png` | 6.6 KB |  |
| `switzer-light.otf` | 35.8 KB |  |

## Herramientas (`tools/`, fuera del ZIP)

| Archivo | Para qué sirve |
|---|---|
| `validate-theme.mjs` | Validador estático (JSON, schemas, Liquid, referencias, traducciones, contraste) |
| `generate-templates.mjs` | Genera `theme/templates/*.json` |
| `build-locale.mjs` + `locale/es.flat.txt` | Compila las cadenas a `theme/locales/es.default.json` |
| `build-zip.mjs` | Crea el ZIP del tema y su SHA-256 |
| `compute-bands.mjs` + `bands.config.json` | Calcula bandas de filtro |
| `list-files.mjs` | Genera este registro |
| `preview/` | Intérprete de Liquid de pruebas, datos de prueba, servidor de previsualización y capturas |
| `tests/` | Pruebas end-to-end en Chromium y generador del informe |
