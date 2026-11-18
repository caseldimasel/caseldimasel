# 06 · Colecciones y filtros (Search & Discovery)

## Colecciones

| Colección | Handle | Plantilla | Condición (automática) |
|---|---|---|---|
| Explorar | `explorar` | `collection.sidonia` | `sidonia.category` = Coches **o** Barcos **o** Casas |
| Coches | `coches` | `collection.garage` | `sidonia.category` = Coches |
| Barcos | `barcos` | `collection.harbor` | `sidonia.category` = Barcos |
| Casas | `casas` | `collection.estate` | `sidonia.category` = Casas |
| Archivo de piezas vendidas | `vendidas` | `collection.sold` | `sidonia.status` = Vendido |
| Destacadas | `destacadas` | (por defecto) | `sidonia.featured` = verdadero |

- Shopify solo admite **«es igual a»** sobre metacampos de texto de una línea en colecciones automáticas; por eso no hay
  condiciones «distinto de». Consecuencia: **las vendidas siguen en su colección de categoría**, con su etiqueta
  «Vendido», al final por el orden editorial; el filtro «Estado» permite ocultarlas. El archivo las agrupa.
- Ordena cada colección en *Ordenación: manual* (selección editorial) o *más recientes*.
- Asigna en *Ajustes del tema > Sidonia · Categorías* la colección de cada categoría (si se deja vacío, el tema busca
  la colección cuyo handle es el nombre público: `coches`, `barcos`, `casas`). La tienda ya tiene `coches-en-venta`: ver [02](02-instalacion.md) §6.

## Filtros

*Apps > Search & Discovery > Filtros*. Shopify admite **25 filtros por tienda** y cada fuente de filtro se usa una vez
([ayuda de Shopify](https://help.shopify.com/en/manual/online-store/search-and-discovery/filters)). Sidonia usa 16:

| Orden | Nombre | Fuente | Se ve en |
|---|---|---|---|
| 1 | Categoría | metacampo `sidonia.category` | Explorar, búsqueda |
| 2 | Estado | `sidonia.status` | todas |
| 3 | Ubicación | `sidonia.region` | todas |
| 4 | Presupuesto | `sidonia.price_band` | todas |
| 5–10 | Marca, Modelo, Año, Kilometraje, Cambio, Combustible | `brand`, `model`, `year_band`, `km_band`, `gearbox`, `fuel` | Coches |
| 11–13 | Tipo de embarcación, Constructor, Eslora | `boat_type`, `builder`, `loa_band` | Barcos |
| 14–16 | Tipo de inmueble, Habitaciones, Superficie | `property_type`, `bedrooms_band`, `area_band` | Casas |

Shopify muestra en cada colección solo los filtros con valores en sus productos: los de barco no salen en Coches.

### Por qué bandas y no rangos

Un filtro de metacampo numérico se muestra como lista de **valores exactos** (1972, 1973, 1974…), no como un rango
«desde–hasta». Para filtrar por tramos se guarda una **banda de texto** en cada pieza:

| Banda | Valores recomendados |
|---|---|
| `year_band` | `Antes de 1960`, `1960-1969`, `1970-1979`, `1980-1989`, `1990-1999`, `2000-2009`, `2010-2019`, `2020 o posterior` |
| `km_band` | `Hasta 49.999 km`, `50.000-99.999 km`, `100.000-149.999 km`, `Más de 150.000 km` |
| `loa_band` | `Hasta 7,99 m`, `8-11,99 m`, `12-14,99 m`, `15-19,99 m`, `20 m o más` |
| `area_band` | `Hasta 99 m²`, `100-249 m²`, `250-499 m²`, `500 m² o más` |
| `bedrooms_band` | `1`, `2`, `3`, `4`, `5 o más` |
| `price_band` | `Hasta 24.999 €`, `25.000-49.999 €`, `50.000-99.999 €`, `100.000-249.999 €`, `250.000-499.999 €`, `500.000-999.999 €`, `Más de 1.000.000 €` (vacía si es «a consultar» o «no publicado») |

Escribe siempre la banda igual (copiar y pegar de esta tabla). El **precio de Shopify** (de la variante) no se usa como
filtro de presupuesto: no es el precio editorial ([10](10-precios-y-compra.md)).

## Comportamiento en la tienda

- Filtrar actualiza resultados **sin recargar** (Section Rendering API), y la URL lleva el estado: recargar, compartir,
  atrás y adelante funcionan. Sin JavaScript, el mismo formulario funciona con un botón «Ver resultados».
- Chips de filtros activos, «Quitar todo», recuento correcto, estado de carga y estado vacío con enlaces útiles.
- Ordenar: «Selección editorial», «Novedades» y, solo si se activa *Sidonia · Catálogo > Las variantes reflejan el precio publicado*,
  precio ascendente/descendente (exige precios de variante coherentes; ver [10](10-precios-y-compra.md)). No hay «Más populares».
- «Cargar más» añade la página siguiente sin perder las anteriores; al volver desde una ficha se restauran páginas y posición.
- Búsqueda: texto de Shopify sobre productos (piezas y productos normales). No es búsqueda semántica.
