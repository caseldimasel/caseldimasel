# 04 · Modelo de datos

> Generado por `node tools/build-docs.mjs` a partir de `data/metafields.json` (fuente única; la usan también
> `tools/setup/provision.mjs` y `tools/check-kit.mjs`). No edites este archivo a mano.

## 1. Principios

- **Cada pieza es un producto de Shopify** (URL, colecciones, búsqueda, SEO). Una pieza única no tiene tallas ni cantidades:
  una sola variante, sin inventario comprable (ver [10-precios-y-compra.md](10-precios-y-compra.md)).
- **Namespace `sidonia`**, definiciones del comerciante en *Ajustes > Datos personalizados > Productos*.
  **Instalar el tema no crea estas definiciones**: se crean a mano o con `node tools/setup/provision.mjs --apply`.
- **Lo que distingue una pieza Sidonia de un producto normal** (libros, láminas…) es el metacampo `sidonia.category`.
  Con él, Impact pinta la tarjeta, el precio y la ficha de Sidonia; sin él, todo sigue como siempre.
- **Datos públicos y privados separados.** Nombre del propietario: solo presentación autorizada. Su teléfono, correo o
  documentos **nunca** van en metacampos (son visibles para la tienda online): viajan por el formulario de venta al correo de la tienda.
- **Desconocido no es cero.** Un dato vacío no se muestra; `0` sí se publica (por ejemplo, 0 km).
- Los valores de prueba son **[PRUEBA]**: sirven para el arnés y para comprobar una ficha en un duplicado, no son datos reales.

## 2. Metacampos de producto

### Comunes a toda pieza

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Referencia | `sidonia.reference` | `single_line_text_field` | sí |  |  | Referencia comercial. Viaja en WhatsApp, correo y formulario. | PR-G-001 |
| Categoría | `sidonia.category` | `single_line_text_field` | sí | sí · colección automática | Coches / Barcos / Casas | Nombre público de la categoría. Elige módulo técnico, punto de color y colección. Filtro «Categoría». | Coches |
| Estado de venta | `sidonia.status` | `single_line_text_field` | sí | sí · colección automática | Disponible / Reservado / Vendido | Estado editorial (no inventario). Etiqueta, filtro, archivo, relacionadas y datos estructurados. | Disponible |
| Gancho editorial | `sidonia.hook` | `single_line_text_field` |  |  |  | Una línea de historia en tarjetas y cabecera de ficha. Sin exageraciones. | Texto de prueba: una línea de historia |
| Qué la hace especial | `sidonia.why_special` | `multi_line_text_field` |  |  |  | Resumen de hechos aportados por el propietario o el equipo. | [PRUEBA] Hechos aportados |
| Hechos destacados | `sidonia.highlights` | `list.single_line_text_field` |  |  |  | Lista de hechos confirmados (no deducir «impecable», «único»…). |  |
| Historia | `sidonia.story` | `rich_text_field` |  |  |  | Narración ampliada de la pieza. |  |
| Procedencia | `sidonia.provenance` | `multi_line_text_field` |  |  |  | Procedencia autorizada. |  |

### Ubicación pública (dónde está HOY)

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| País (ubicación actual) | `sidonia.country` | `single_line_text_field` |  |  |  | Dónde está HOY la pieza (no fabricación ni matriculación). | España |
| Región o provincia (ubicación actual) | `sidonia.region` | `single_line_text_field` |  | sí |  | Ubicación pública. Filtro «Ubicación». | Región de prueba |
| Ciudad o zona (ubicación actual) | `sidonia.city` | `single_line_text_field` |  |  |  | Solo se muestra si la precisión es «Ciudad». Nunca dirección exacta. | Ciudad de prueba |
| Precisión de la ubicación publicada | `sidonia.location_precision` | `single_line_text_field` |  |  | Ciudad / Región / País | Qué parte de la ubicación se publica. Sin dato: Región. | Región |

### Propietario (solo presentación pública autorizada)

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Nombre público del propietario | `sidonia.owner_name` | `single_line_text_field` |  |  |  | Nombre de pila o profesional AUTORIZADO. Nunca datos de contacto. | Nombre de prueba |
| Mostrar el nombre del propietario | `sidonia.owner_show_name` | `boolean` |  |  |  | Verdadero solo con autorización expresa. | true |
| Descripción del propietario si no se muestra el nombre | `sidonia.owner_label` | `single_line_text_field` |  |  |  | Descripción real, p. ej. «Propietario particular». | Propietario particular |
| Historia pública del propietario | `sidonia.owner_story` | `multi_line_text_field` |  |  |  | Breve, real y autorizada. |  |

### Precio editorial

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Modo de precio | `sidonia.price_mode` | `single_line_text_field` | sí |  | Publicado / A consultar / No publicado | Qué se enseña. Sin dato: «Precio no publicado». Nunca un 0. | Publicado |
| Precio de referencia público | `sidonia.price_amount` | `number_decimal` |  |  |  | Solo con modo «Publicado» y valor mayor que 0. Independiente del precio de la variante. | 85000 |
| Moneda del precio | `sidonia.price_currency` | `single_line_text_field` |  |  |  | Código ISO (EUR). Sin dato: moneda de la tienda. | EUR |

### Vídeo

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Vídeo principal (archivo) | `sidonia.video` | `file_reference` |  |  |  | FUENTE CANÓNICA del vídeo narrado (Contenido > Archivos). |  |
| Clip breve de previsualización | `sidonia.preview_clip` | `file_reference` |  |  |  | Bucle silencioso opcional (6-12 s). |  |
| Vídeo externo (YouTube o Vimeo) | `sidonia.video_url` | `url` |  |  |  | Solo si no hay vídeo alojado en Shopify. Instagram/TikTok no son vídeos reproducibles: van en social_url. |  |
| Proporción del vídeo externo | `sidonia.video_aspect` | `single_line_text_field` |  |  | 9:16 / 16:9 / 4:5 / 1:1 / 4:3 | Los vídeos de Shopify ya traen su proporción. |  |
| Duración del vídeo (segundos) | `sidonia.video_duration` | `number_integer` |  |  |  | Se muestra como m:ss solo si se conoce. | 83 |
| Idioma del vídeo | `sidonia.video_language` | `single_line_text_field` |  |  |  | Sin dato: ajuste del tema. | Español |
| Subtítulos (.vtt) | `sidonia.subtitles_file` | `file_reference` |  |  |  | Pista WebVTT del reproductor. |  |
| Idioma de los subtítulos | `sidonia.subtitles_lang` | `single_line_text_field` |  |  |  | Código, p. ej. «es». | es |
| Transcripción | `sidonia.transcript` | `multi_line_text_field` |  |  |  | Vía adicional de acceso al contenido del vídeo. |  |
| Publicación original en redes | `sidonia.social_url` | `url` |  |  |  | Enlace «Ver la publicación original». |  |

### Detalles, documentos y relaciones

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Estado y observaciones | `sidonia.condition_notes` | `multi_line_text_field` |  |  |  | Solo lo que se sabe. No es una inspección. |  |
| Trabajos realizados | `sidonia.work_done` | `list.single_line_text_field` |  |  |  | Lista de trabajos conocidos. |  |
| Documentos públicos | `sidonia.documents` | `list.file_reference` |  |  |  | Descargas PÚBLICAS. Nunca documentación personal. |  |
| Cronología | `sidonia.timeline` | `list.metaobject_reference` |  |  |  | Hitos con fechas reales. |  |
| Piezas relacionadas | `sidonia.related` | `list.product_reference` |  |  |  | Selección manual (si falta, misma categoría). |  |
| Destacada en portada | `sidonia.featured` | `boolean` |  |  · colección automática |  | Condición de la colección «Destacadas» que usa la portada. | true |

### Coches

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Marca | `sidonia.brand` | `single_line_text_field` |  | sí |  | Filtro. Escríbela igual en todas las piezas. | Marca A |
| Modelo | `sidonia.model` | `single_line_text_field` |  | sí |  | Compartido con barcos. | Modelo A |
| Versión | `sidonia.version` | `single_line_text_field` |  |  |  |  |  |
| Año | `sidonia.year` | `number_integer` |  |  |  | Compartido con barcos. | 1972 |
| Kilometraje (km) | `sidonia.mileage_km` | `number_integer` |  |  |  | Vacío si no se conoce (0 se publica como 0 km). | 84000 |
| Combustible | `sidonia.fuel` | `single_line_text_field` |  | sí |  |  | Gasolina |
| Cambio | `sidonia.gearbox` | `single_line_text_field` |  | sí |  |  | Manual |
| Potencia (CV) | `sidonia.power_hp` | `number_integer` |  |  |  | Solo si se conoce. | 130 |
| Color | `sidonia.color` | `single_line_text_field` |  |  |  |  |  |

### Barcos

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Constructor (astillero) | `sidonia.builder` | `single_line_text_field` |  | sí |  | Filtro. | Constructor A |
| Tipo de embarcación | `sidonia.boat_type` | `single_line_text_field` |  | sí |  | Filtro. | Velero |
| Eslora (m) | `sidonia.length_m` | `number_decimal` |  |  |  |  | 12.5 |
| Manga (m) | `sidonia.beam_m` | `number_decimal` |  |  |  | Solo si se conoce. |  |
| Motorización | `sidonia.engine` | `single_line_text_field` |  |  |  |  | Diésel 40 CV |
| Horas de motor | `sidonia.engine_hours` | `number_integer` |  |  |  | Solo si se conocen. |  |
| Régimen fiscal declarado | `sidonia.tax_regime` | `single_line_text_field` |  |  |  | Solo si es pertinente y está confirmado. |  |

### Casas

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Tipo de inmueble | `sidonia.property_type` | `single_line_text_field` |  | sí |  | Filtro. | Masía |
| Superficie | `sidonia.area_value` | `number_decimal` |  |  |  |  | 320 |
| Unidad de superficie | `sidonia.area_unit` | `single_line_text_field` |  |  |  | Sin dato: m². | m² |
| Parcela (m²) | `sidonia.plot_area` | `number_decimal` |  |  |  | Solo si existe. |  |
| Dormitorios | `sidonia.bedrooms` | `number_integer` |  |  |  |  | 5 |
| Baños | `sidonia.bathrooms` | `number_integer` |  |  |  |  |  |
| Época de construcción | `sidonia.built_period` | `single_line_text_field` |  |  |  | Texto libre conocido («años 60»). |  |
| Certificación energética | `sidonia.energy_rating` | `single_line_text_field` |  |  |  | Solo si se aporta. |  |

### Bandas para filtros (texto)

| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |
|---|---|---|---|---|---|---|---|
| Banda de año | `sidonia.year_band` | `single_line_text_field` |  | sí |  | Filtro «Año» (p. ej. «1970-1979»). | 1970-1979 |
| Banda de kilometraje | `sidonia.km_band` | `single_line_text_field` |  | sí |  | Filtro «Kilometraje». | 50.000-99.999 km |
| Banda de eslora | `sidonia.loa_band` | `single_line_text_field` |  | sí |  | Filtro «Eslora». | 12-14,99 m |
| Banda de superficie | `sidonia.area_band` | `single_line_text_field` |  | sí |  | Filtro «Superficie». | 250-499 m² |
| Banda de habitaciones | `sidonia.bedrooms_band` | `single_line_text_field` |  | sí |  | Filtro «Habitaciones». | 5 o más |
| Banda de presupuesto | `sidonia.price_band` | `single_line_text_field` |  | sí |  | Filtro «Presupuesto» (vacío en piezas a consultar o no publicadas). | 50.000-99.999 € |

## 3. Metaobjetos

### Hito de cronología (`sidonia_timeline_event`)

Acceso desde la tienda online: **activado (necesario)** · campo que lo identifica: `title`

| Campo | Clave | Tipo | Obligatorio | Valores |
|---|---|---|---|---|
| Fecha o periodo | `period` | `single_line_text_field` | sí |  |
| Título | `title` | `single_line_text_field` | sí |  |
| Descripción | `description` | `multi_line_text_field` |  |  |

### Cuenta social de Sidonia (`sidonia_social_account`)

Acceso desde la tienda online: **activado (necesario)** · campo que lo identifica: `name`

| Campo | Clave | Tipo | Obligatorio | Valores |
|---|---|---|---|---|
| Red | `network` | `single_line_text_field` | sí | Instagram / TikTok / YouTube / Facebook / X / LinkedIn / Pinterest / Otra |
| Nombre público de la cuenta | `name` | `single_line_text_field` | sí |  |
| URL del perfil | `url` | `url` | sí |  |
| Seguidores (cifra real) | `followers` | `number_integer` |  |  |
| Incluir en el total | `include_in_total` | `boolean` |  |  |
| Fecha de la cifra | `updated_on` | `date` |  |  |

**Cuentas sociales:** cada cuenta es una entrada; el total se **calcula** sumando `followers` de las entradas con
`include_in_total` verdadero, sin repetir una cuenta (misma URL normalizada o misma red + nombre). Una cifra vacía no es 0
y no se suma. Si ninguna cuenta tiene cifra, no se muestra total: solo «Sigue las historias de Sidonia» y los enlaces.
No existe un total manual.

## 4. Filtros (Search & Discovery)

Presupuesto de filtros: Shopify admite hasta 25 filtros por tienda y 50 definiciones de metacampo usadas como filtro (help.shopify.com, consultado el 4/10/2026). Los numéricos se filtran por valor exacto, no por rango: por eso hay bandas.

| Orden | Filtro | Metacampo |
|---|---|---|
| 1 | Categoría | `sidonia.category` |
| 2 | Estado | `sidonia.status` |
| 3 | Ubicación | `sidonia.region` |
| 4 | Presupuesto | `sidonia.price_band` |
| 5 | Marca | `sidonia.brand` |
| 6 | Modelo | `sidonia.model` |
| 7 | Año | `sidonia.year_band` |
| 8 | Kilometraje | `sidonia.km_band` |
| 9 | Cambio | `sidonia.gearbox` |
| 10 | Combustible | `sidonia.fuel` |
| 11 | Tipo de embarcación | `sidonia.boat_type` |
| 12 | Constructor | `sidonia.builder` |
| 13 | Eslora | `sidonia.loa_band` |
| 14 | Tipo de inmueble | `sidonia.property_type` |
| 15 | Habitaciones | `sidonia.bedrooms_band` |
| 16 | Superficie | `sidonia.area_band` |

## 5. Colecciones automáticas

Solo condiciones **«es igual a»** sobre metacampos de texto de una línea (lo que admite Shopify para colecciones automáticas).

| Colección | Handle | Plantilla | Condición |
|---|---|---|---|
| Explorar | `explorar` | `collection.sidonia` | `sidonia.category` = «Coches» **o** `sidonia.category` = «Barcos» **o** `sidonia.category` = «Casas» |
| Coches | `coches` | `collection.garage` | `sidonia.category` = «Coches» |
| Barcos | `barcos` | `collection.harbor` | `sidonia.category` = «Barcos» |
| Casas | `casas` | `collection.estate` | `sidonia.category` = «Casas» |
| Archivo de piezas vendidas | `vendidas` | `collection.sold` | `sidonia.status` = «Vendido» |
| Destacadas | `destacadas` | (por defecto) | `sidonia.featured` = «true» |

## 6. Páginas

| Página | Handle | Plantilla |
|---|---|---|
| Vender con Sidonia | `/pages/vender-con-sidonia` | `page.sell` |
| Cómo vendemos | `/pages/como-vendemos` | `page.how-it-works` |
| Sobre Sidonia | `/pages/sobre-sidonia` | `page.sidonia-about` |
| Favoritos | `/pages/favoritos` | `page.favorites` |
| Contacto | `/pages/contacto` | `page.sidonia-contact` |
| Cuéntanos qué buscas | `/pages/busco` | `page.wanted` |

Menú propuesto `sidonia-principal`: Explorar (`/collections/explorar`) · Coches (`/collections/coches`) · Barcos (`/collections/barcos`) · Casas (`/collections/casas`) · Cómo vendemos (`/pages/como-vendemos`) · Sobre Sidonia (`/pages/sobre-sidonia`).

## 7. Cómo los lee el tema (Liquid)

```liquid
{%- comment -%} Precio editorial: nunca el precio de la variante {%- endcomment -%}
{%- render 'sidonia-price', product: product -%}            → «85.000 €», «Precio a consultar», «Precio no publicado»
{%- render 'sidonia-location', product: product -%}         → «Región de prueba, España» (según la precisión)
{%- render 'sidonia-owner', product: product -%}            → nombre autorizado o descripción; si no, nada
{%- render 'sidonia-category', product: product -%}         → garage | harbor | estate (clave interna)
{{ product.metafields.sidonia.year.value }}                 → lectura directa de un dato
```

Los snippets `sidonia-spec` y `sidonia-specs` dan formato español a los números (4 cifras sin separador, 5 o más con
punto, decimales con coma) y ocultan lo desconocido.
