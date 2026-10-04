# 04 · Colecciones y filtros (Search & Discovery)

## 1. Colecciones

Crea **colecciones inteligentes** (con condiciones automáticas) para que una pieza aparezca donde toca sin trabajo manual:

| Colección (handle) | Plantilla | Condiciones (todas) |
|---|---|---|
| `explorar` | `collection` | Etiqueta es `pieza` **y** `sidonia.status` no es `Vendido` |
| `garage` | `collection.garage` | `sidonia.category` es `Garage` **y** `sidonia.status` no es `Vendido` |
| `harbor` | `collection.harbor` | `sidonia.category` es `Harbor` **y** `sidonia.status` no es `Vendido` |
| `estate` | `collection.estate` | `sidonia.category` es `Estate` **y** `sidonia.status` no es `Vendido` |
| `archivo` | `collection.archive` | Etiqueta es `pieza` **y** `sidonia.status` es `Vendido` |
| `destacadas` (opcional) | — | `sidonia.featured` es verdadero **y** `sidonia.status` no es `Vendido` |

Notas:

- Para usar un metacampo en condiciones, su definición debe tener activado «Usar en colecciones inteligentes». Las condiciones disponibles (p. ej. «no es igual a») dependen de la versión del administrador: si no hay «no es», usa una etiqueta `disponible`/`reservado` mantenida a mano o por una automatización.
- Pon la etiqueta `pieza` a todos los productos-anuncio. Así `explorar` y `archivo` no incluyen otros productos de la tienda.
- Ordena cada colección en **«Manualmente»** si quieres decidir el orden: es la «Selección editorial». El tema ofrece también «Novedades» (más recientes primero).
- El tema enlaza cada división con su colección en *Ajustes del tema → Divisiones* y *Colecciones generales*. El **número de piezas** de «Tres mundos» sale de esa misma colección, por lo que coincide con lo que ve el visitante.
- Los vendidos **no se mezclan** con los disponibles: salen en `archivo`, con estado «Vendido» inequívoco. Los reservados salen en las colecciones con su etiqueta «Reservado».

## 2. Que las piezas «no disponibles» sigan visibles

Todas las piezas tienen inventario 0 (para que no se puedan comprar, ver `05`). Comprueba, en **Search & Discovery → Configuración**, que **no esté activada la opción de ocultar los productos agotados** (o equivalente en tu versión), tanto en colecciones como en búsqueda. Si Shopify los oculta, el catálogo aparecería vacío. Esto **no se ha podido verificar** (consta en `09`).

## 3. Filtros: presupuesto y distribución

Los filtros se configuran en la app **Shopify Search & Discovery → Filtros**. El tema solo los **pinta** (`collection.filters` / `search.filters`): consultan todo el catálogo, no solo la página visible.

> No se pudo consultar el límite vigente de filtros de la tienda ni los tipos de metacampo admitidos. **Verifícalo en la app antes de crear los filtros.** La propuesta usa 15 filtros, un número moderado para repartirlo entre tres categorías.

| # | Filtro | Metacampo | Categoría | Tipo de filtro |
|---|---|---|---|---|
| 1 | Categoría | `sidonia.category` | Comunes | Lista |
| 2 | Estado | `sidonia.status` | Comunes | Lista |
| 3 | Ubicación | `sidonia.region` | Comunes | Lista |
| 4 | Presupuesto | `sidonia.price_band` | Comunes | Lista (banda) |
| 5 | Marca | `sidonia.brand` | Garage | Lista |
| 6 | Año | `sidonia.year_band` | Garage y Harbor (compartido) | Lista (banda) |
| 7 | Kilometraje | `sidonia.km_band` | Garage | Lista (banda) |
| 8 | Cambio | `sidonia.gearbox` | Garage | Lista |
| 9 | Combustible | `sidonia.fuel` | Garage | Lista |
| 10 | Tipo de embarcación | `sidonia.boat_type` | Harbor | Lista |
| 11 | Constructor | `sidonia.builder` | Harbor | Lista |
| 12 | Eslora | `sidonia.loa_band` | Harbor | Lista (banda) |
| 13 | Tipo de inmueble | `sidonia.property_type` | Estate | Lista |
| 14 | Habitaciones | `sidonia.bedrooms_band` | Estate | Lista (banda) |
| 15 | Superficie | `sidonia.area_band` | Estate | Lista (banda) |

Un filtro solo aparece en una colección si hay piezas con valores en esa colección: en `garage` salen los de coches, en `harbor` los de barcos. En `explorar` aparecen los comunes y los de cada categoría con datos; los grupos están **plegados** salvo los tres primeros y los activos.

Opcional: marca «Orden de valores» manual en cada filtro de bandas para que salgan en el orden lógico (de menor a mayor).

## 4. Rangos: por qué bandas

Un metacampo numérico **no** implica que Shopify ofrezca un rango arbitrario (deslizador o mínimo/máximo). Para no construir una interfaz que no consulta valores reales, el tema usa **bandas de texto coherentes** como filtro. Las etiquetas están en `tools/bands.config.json`.

Cómo se mantienen:

1. A mano, copiando la banda correspondiente al número.
2. Con `tools/compute-bands.mjs`: lee un CSV (`handle, year, mileage_km, length_m, area_value, bedrooms, price_amount, price_mode`) y devuelve las bandas. Ejemplo: `node tools/compute-bands.mjs piezas.csv > bandas.csv`.
3. Con una automatización de Shopify Flow que calcule la banda al guardar el producto (requiere la app Flow; no incluida).

Si más adelante hace falta un rango numérico real (por ejemplo, un deslizador de precio), hará falta una integración de búsqueda o un filtro nativo de precio sobre el precio de variante (ver `05`).

El filtro nativo de **precio** del tema está apagado por defecto y se activa en *Catálogo y funciones* con la advertencia explicada en `05`.

## 5. Estado en la URL y SEO

- Cada filtro, orden y página vive en la URL (`?filter.p.m.sidonia.brand=…&sort_by=…&page=2`): recargar, compartir enlace, atrás y adelante funcionan.
- Las URL con filtros activos llevan `noindex, follow`; los resultados de búsqueda también. No se crean páginas de faceta indexables. El sitemap de Shopify no se toca; **no se incluye `robots.txt.liquid`** (se respeta el de Shopify).
- Paginación real con enlaces (`rel=prev/next`) y «Cargar más» como mejora progresiva.

## 6. Búsqueda

La búsqueda es **textual**: título, descripción, etiquetas, proveedor y tipo. Para que «Porsche» encuentre una pieza, pon la marca o el constructor en **Proveedor** y el tipo en **Tipo de producto** (`Coche`, `Barco`, `Casa`), además de en el título. No hay búsqueda semántica («una casa con historia cerca del mar»): sería una mejora separada (ver `13-hoja-de-ruta.md`).
