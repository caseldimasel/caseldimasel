# 03 · Modelo de datos en Shopify

Cada pieza es un **producto de Shopify**. El tema lee sus datos de campos estándar (título, imágenes, medios, fecha de publicación) y de **metacampos del propietario de la tienda con el namespace `sidonia`**.

> **Importante.** Instalar el ZIP del tema **no crea** metacampos ni metaobjetos. Hay que crear las definiciones una vez en el administrador (sección «Cómo crear las definiciones»). Mientras no existan, el tema funciona pero las fichas salen vacías y se ocultan los bloques sin datos.
>
> Los nombres de pantalla del administrador pueden haber cambiado desde la redacción de este documento: no se pudo consultar la documentación vigente de Shopify (ver `09-informe-de-pruebas.md`).

## 1. Esquema (qué datos existen)

Convenciones:

- **Obligatorio** = sin él la ficha no se comporta bien. El resto son opcionales y, si faltan, el tema los oculta (nunca los convierte en 0).
- **Público** = lo ve cualquier visitante de la web. **Nada de lo que está en esta tabla debe contener datos personales de propietarios.**
- Los valores de las listas de opciones se guardan **tal cual** (con mayúscula inicial) porque son los que aparecen en los filtros. El tema los compara sin distinguir mayúsculas.

### 1.1 Comunes

| Nombre visible | Namespace.clave | Tipo en Shopify | Uso | Oblig. | Público |
|---|---|---|---|---|---|
| Referencia | `sidonia.reference` | Texto de una línea | Referencia comercial. Va en WhatsApp, email y formulario | Sí | Sí |
| Categoría | `sidonia.category` | Texto de una línea, con opciones: `Garage`, `Harbor`, `Estate` | Elige módulo técnico, color, división y colección. Filtro | Sí | Sí |
| Estado editorial | `sidonia.status` | Texto de una línea, con opciones: `Disponible`, `Reservado`, `Vendido` | Etiqueta, filtro, archivo, relacionadas, datos estructurados | Sí | Sí |
| Gancho | `sidonia.hook` | Texto de una línea | Una línea de historia en tarjetas y cabecera de ficha | No | Sí |
| Por qué es especial | `sidonia.why_special` | Texto de varias líneas | Resumen en el bloque «Qué la hace especial» y en la descripción estructurada | No | Sí |
| Hechos destacados | `sidonia.highlights` | Lista de textos de una línea | Lista con marcas en «Qué la hace especial». Solo hechos confirmados | No | Sí |
| Historia | `sidonia.story` | Texto enriquecido | La historia completa | No | Sí |
| Procedencia | `sidonia.provenance` | Texto de varias líneas | Procedencia autorizada | No | Sí |
| País | `sidonia.country` | Texto de una línea | Ubicación pública | No | Sí |
| Región | `sidonia.region` | Texto de una línea | Ubicación pública. Filtro «Ubicación» | No | Sí |
| Ciudad | `sidonia.city` | Texto de una línea | Solo se muestra si la precisión es «Ciudad» | No | Sí |
| Precisión de la ubicación | `sidonia.location_precision` | Texto de una línea, con opciones: `Ciudad`, `Región`, `País` | Controla qué parte de la ubicación se publica. Sin dato = Región | No | Sí |
| Modo de precio | `sidonia.price_mode` | Texto de una línea, con opciones: `Publicado`, `A consultar`, `No publicado` | Decide qué se enseña. Sin dato = «Precio no publicado» | Sí | Sí |
| Precio de referencia | `sidonia.price_amount` | Decimal | Importe público. Solo se usa con modo `Publicado` y valor mayor que 0 | Si hay precio | Sí |
| Moneda del precio | `sidonia.price_currency` | Texto de una línea (código ISO, p. ej. `EUR`) | Sin dato = moneda de la tienda | No | Sí |
| Vídeo principal | `sidonia.video` | Referencia a archivo (vídeo) | **Fuente canónica del vídeo** (ver `07-video.md`) | No | Sí |
| Clip de previsualización | `sidonia.preview_clip` | Referencia a archivo (vídeo) | Bucle silencioso breve en la ficha (solo escritorio) | No | Sí |
| Vídeo externo (URL) | `sidonia.video_url` | URL | YouTube o Vimeo, solo si no hay vídeo alojado en Shopify | No | Sí |
| Proporción del vídeo | `sidonia.video_aspect` | Texto de una línea, con opciones: `9:16`, `16:9`, `4:5`, `1:1`, `4:3` | Solo para vídeos externos. Los vídeos de Shopify traen su proporción | No | Sí |
| Duración (segundos) | `sidonia.video_duration` | Número entero | Se muestra como m:ss si se conoce | No | Sí |
| Idioma del vídeo | `sidonia.video_language` | Texto de una línea | Sin dato = ajuste del tema | No | Sí |
| Subtítulos | `sidonia.subtitles_file` | Referencia a archivo (archivo genérico `.vtt`) | Pista de subtítulos del reproductor | No | Sí |
| Idioma de los subtítulos | `sidonia.subtitles_lang` | Texto de una línea (p. ej. `es`) | Atributo `srclang` | No | Sí |
| Transcripción | `sidonia.transcript` | Texto de varias líneas | Vía de acceso adicional al contenido del vídeo | No | Sí |
| Publicación original | `sidonia.social_url` | URL | Enlace «Ver la publicación original» | No | Sí |
| Estado y observaciones | `sidonia.condition_notes` | Texto de varias líneas | Solo lo que se sabe | No | Sí |
| Trabajos realizados | `sidonia.work_done` | Lista de textos de una línea | Lista de trabajos | No | Sí |
| Documentos | `sidonia.documents` | Lista de referencias a archivo (genéricos) | Descargas **públicas**. No subir documentación personal | No | Sí (los archivos son públicos) |
| Cronología | `sidonia.timeline` | Lista de referencias a metaobjeto (`sidonia_timeline_event`) | Línea de tiempo con fechas reales | No | Sí |
| Piezas relacionadas | `sidonia.related` | Lista de referencias a producto | Selección manual de relacionadas | No | Sí |
| Destacada | `sidonia.featured` | Verdadero o falso | Condición para una colección «Destacadas» usada por la home | No | Sí |
| Orden editorial | `sidonia.editorial_order` | Número entero | **Solo documental**: el orden real es el orden manual de cada colección | No | Sí |
| Banda de año | `sidonia.year_band` | Texto de una línea | Filtro (ver `04`) | Si se filtra | Sí |
| Banda de precio | `sidonia.price_band` | Texto de una línea | Filtro de presupuesto (ver `04`) | Si se filtra | Sí |

La **fecha de publicación** es la nativa del producto (`published_at`). El **nombre**, el **SEO** (título y metadescripción de la ficha) y la **portada** (primera imagen del producto) también son nativos.

### 1.2 Garage (coches)

| Nombre visible | Namespace.clave | Tipo | Notas |
|---|---|---|---|
| Marca | `sidonia.brand` | Texto de una línea | Filtro. Pon la marca también en «Proveedor» del producto para la búsqueda |
| Modelo | `sidonia.model` | Texto de una línea | Compartido con Harbor |
| Versión | `sidonia.version` | Texto de una línea | |
| Año | `sidonia.year` | Número entero | |
| Kilometraje | `sidonia.mileage_km` | Número entero | 0 se muestra como 0 km: déjalo vacío si no se conoce |
| Combustible | `sidonia.fuel` | Texto de una línea | Filtro |
| Cambio | `sidonia.gearbox` | Texto de una línea | Filtro |
| Potencia (CV) | `sidonia.power_hp` | Número entero | |
| Color | `sidonia.color` | Texto de una línea | |
| Banda de kilometraje | `sidonia.km_band` | Texto de una línea | Filtro |

### 1.3 Harbor (barcos)

| Nombre visible | Namespace.clave | Tipo | Notas |
|---|---|---|---|
| Constructor | `sidonia.builder` | Texto de una línea | Filtro. Pon también el constructor en «Proveedor» |
| Modelo | `sidonia.model` | Texto de una línea | |
| Tipo de embarcación | `sidonia.boat_type` | Texto de una línea | Filtro |
| Año | `sidonia.year` | Número entero | |
| Eslora (m) | `sidonia.length_m` | Decimal | |
| Manga (m) | `sidonia.beam_m` | Decimal | Solo si se conoce |
| Motorización | `sidonia.engine` | Texto de una línea | |
| Horas de motor | `sidonia.engine_hours` | Número entero | Solo si se conocen |
| Régimen fiscal declarado | `sidonia.tax_regime` | Texto de una línea | Solo si está confirmado |
| Banda de eslora | `sidonia.loa_band` | Texto de una línea | Filtro |

### 1.4 Estate (casas)

| Nombre visible | Namespace.clave | Tipo | Notas |
|---|---|---|---|
| Tipo de inmueble | `sidonia.property_type` | Texto de una línea | Filtro |
| Superficie | `sidonia.area_value` | Decimal | |
| Unidad de superficie | `sidonia.area_unit` | Texto de una línea | Sin dato = `m²` |
| Parcela (m²) | `sidonia.plot_area` | Decimal | Solo si existe |
| Dormitorios | `sidonia.bedrooms` | Número entero | |
| Baños | `sidonia.bathrooms` | Número entero | |
| Época de construcción | `sidonia.built_period` | Texto de una línea | Texto libre («años 60») |
| Certificación energética | `sidonia.energy_rating` | Texto de una línea | Solo si se aporta |
| Banda de superficie | `sidonia.area_band` | Texto de una línea | Filtro |
| Banda de dormitorios | `sidonia.bedrooms_band` | Texto de una línea | Filtro |

**Dirección exacta, matrículas completas, DNI y datos del propietario no tienen campo en el modelo, a propósito.**

### 1.5 Metaobjeto (único)

Definición `sidonia_timeline_event` («Hito de cronología»):

| Campo | Clave | Tipo |
|---|---|---|
| Fecha o periodo | `period` | Texto de una línea |
| Título | `title` | Texto de una línea |
| Descripción | `description` | Texto de varias líneas |

Se usa solo para la cronología porque es una lista ordenada y reutilizable por pieza. Testimonios, equipo y divisiones se editan como **bloques de sección** o **ajustes del tema**: mantenerlos como metaobjetos para tres categorías sobredimensionaba el modelo.

## 2. Cómo crear las definiciones (una sola vez)

1. Administrador de Shopify → **Ajustes → Datos personalizados → Productos → Añadir definición**.
2. Nombre visible: el de la tabla. Namespace y clave: exactamente `sidonia.<clave>`. Tipo: el de la tabla.
3. Para los textos con opciones (`category`, `status`, `price_mode`, `location_precision`, `video_aspect`) añade la validación «lista de opciones» con los valores indicados.
4. Activa **«Usar en colecciones inteligentes»** y **«Filtros»** (si la definición lo ofrece) en: `category`, `status`, `region`, `price_band`, `brand`, `year_band`, `km_band`, `gearbox`, `fuel`, `boat_type`, `builder`, `loa_band`, `property_type`, `bedrooms_band`, `area_band`, `featured`.
5. **No actives «Acceso a la Storefront API»** salvo que lo necesites: el tema lee los metacampos desde Liquid.
6. Crea la definición del metaobjeto `sidonia_timeline_event` en **Ajustes → Datos personalizados → Metaobjetos** y, después, el metacampo `sidonia.timeline` (lista de referencias a ese metaobjeto).

Los metacampos de tipo archivo (`video`, `preview_clip`, `subtitles_file`, `documents`) reciben los archivos que subas a **Contenido → Archivos** o desde la propia ficha.

## 3. Cómo introducir valores

- A mano en la ficha del producto (sección «Metacampos»), o
- importando un CSV de productos (comprueba en tu versión del administrador cómo nombra las columnas de metacampos), o
- con una herramienta de importación masiva de terceros.

Para calcular las **bandas** a partir de los números reales usa `node tools/compute-bands.mjs piezas.csv > bandas.csv` (ver `04-colecciones-y-filtros.md`).

### Valores de prueba (para un entorno de pruebas autorizado)

Rotula siempre las piezas de prueba con **[PRUEBA]** en el título y **no las publiques en la tienda real**.

| Campo | Coche | Barco | Casa |
|---|---|---|---|
| Título | [PRUEBA] Coche de ejemplo A | [PRUEBA] Barco de ejemplo A | [PRUEBA] Casa de ejemplo A |
| `reference` | PR-G-001 | PR-H-001 | PR-E-001 |
| `category` | Garage | Harbor | Estate |
| `status` | Disponible | Disponible | Disponible |
| `price_mode` / `price_amount` | Publicado / 85000 | A consultar / (vacío) | Publicado / 1450000 |
| `region` / `precision` | Región de prueba / Región | Baleares / Región | Mallorca / Ciudad (+ `city`) |
| Datos | `brand`, `model`, `year`=1972, `mileage_km`=84000, `gearbox`=Manual, `fuel`=Gasolina | `builder`, `boat_type`=Velero, `year`=1988, `length_m`=12.5 | `property_type`=Masía, `area_value`=320, `bedrooms`=5, `bathrooms`=3 |
| Bandas | `year_band`=1970-1979, `km_band`=50.000-99.999 km, `price_band`=50.000-99.999 € | `year_band`=1980-1989, `loa_band`=12-14,99 m | `area_band`=250-499 m², `bedrooms_band`=5 o más |

El repositorio incluye `tools/preview/store.mjs` con un conjunto completo de piezas de prueba (válidas, a consultar, sin datos, vendidas, con YouTube, sin portada) que se usa en `tools/tests`. **No forma parte del ZIP.**

## 4. Cómo se leen desde Liquid

El tema nunca duplica texto de una pieza en el código. Los fragmentos reutilizables son:

| Snippet | Qué devuelve |
|---|---|
| `listing-category` | `garage`, `harbor`, `estate` o nada. Lee `sidonia.category`; si falta, el sufijo de plantilla del producto |
| `listing-status` | `available`, `reserved`, `sold` o nada. **No usa el inventario** |
| `listing-price` | Texto de precio, o `kind` (`published`/`request`/`hidden`), `amount`, `currency` |
| `listing-location` | Ubicación pública según la precisión |
| `listing-specs` | 2–3 datos clave para tarjetas |
| `listing-facts` | Filas de datos técnicos por grupo (`key`, `identity`, `mechanics`, …) |
| `video-attrs` | Atributos `data-video-*` para reproducir bajo demanda (orden de fuentes en `07`) |
| `contact-link` | Enlace de WhatsApp, email o teléfono. **No emite nada si el canal no está configurado** |
| `structured-listing` | JSON-LD de la pieza (y `VideoObject` si procede) |

Ejemplo de lectura directa en Liquid:

```liquid
{{ product.metafields.sidonia.year.value }}
{% assign km = product.metafields.sidonia.mileage_km.value %}
{% if km != blank %}…{% endif %}
{{ product.metafields.sidonia.story | metafield_tag }}
```

Para añadir un dato nuevo: crea la definición, añade la fila en `snippets/listing-facts.liquid` (y, si debe salir en tarjetas, en `listing-specs.liquid`) y la cadena en `tools/locale/es.flat.txt`.
