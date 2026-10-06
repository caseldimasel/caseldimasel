# 06 · Cómo crear una ficha de coche, de barco y de casa

Requisitos previos: definiciones de metacampos creadas (`03`), colecciones (`04`), tema subido sin publicar (`02`).

## Pasos comunes (los tres tipos)

1. **Productos → Añadir producto**.
2. **Título**: nombre claro de la pieza (es el título de tarjeta y de ficha).
3. **Descripción**: texto breve y fiel (se usa como respaldo en SEO y datos estructurados). La historia larga va en el metacampo `Historia`.
4. **Medios**: sube la **portada** como primera imagen. Fija su **punto focal** (editar imagen → punto focal) para que el recorte de tarjetas no corte caras ni el coche. El vídeo principal **no** se sube aquí: va en el metacampo `Vídeo principal` (ver `07`).
5. **Precio**: una sola variante. Ver `05` (precio de variante 0 salvo que uses el orden/filtro nativo de precio).
6. **Inventario**: seguimiento activado, cantidad 0, «seguir vendiendo» desactivado. **Canales**: solo Tienda online.
7. **Organización**: etiqueta `pieza`; **Proveedor** = marca / constructor / (agencia en casas); **Tipo** = `Coche`, `Barco` o `Casa`.
8. **Plantilla de tema**: `product.coches`, `product.barcos` o `product.casas`.
9. **Optimización SEO**: título de página y metadescripción propios (se usan tal cual).
10. **Metacampos**: rellena los comunes (`reference`, `category`, `status`, `price_mode`, ubicación…) y los de la categoría.
11. Guarda en **Borrador** hasta revisar la vista previa; al publicar, aparecerá en las colecciones inteligentes.

## Ficha de coche (punto rojo)

| Campo | Ejemplo de prueba |
|---|---|
| `category` | Coche |
| `reference` | PR-G-001 |
| `brand` · `model` · `version` · `year` | Marca A · Modelo A · Versión A · 1972 |
| `mileage_km` | 84000 (vacío si no se conoce) |
| `fuel` · `gearbox` · `power_hp` · `color` | Gasolina · Manual · 130 · Rojo |
| `year_band` · `km_band` | 1970-1979 · 50.000-99.999 km |
| `price_mode` · `price_amount` | Publicado · 85000 → «85.000 €» |
| `region` · `location_precision` | Región de prueba · Región |

Resultado: datos esenciales (año, kilometraje, cambio, combustible, potencia, color), grupos Identidad / Mecánica / Aspecto, y ubicación «Región de prueba, España». Un dato vacío **no sale** en la ficha.

## Ficha de barco (punto azul)

| Campo | Ejemplo de prueba |
|---|---|
| `category` | Barco |
| `builder` · `model` · `boat_type` · `year` | Constructor A · Modelo · Velero · 1988 |
| `length_m` · `beam_m` | 12.5 · 3.8 (manga solo si se conoce) |
| `engine` · `engine_hours` · `tax_regime` | Diésel 40 CV · 2100 · solo si está confirmado |
| `year_band` · `loa_band` | 1980-1989 · 12-14,99 m |
| `price_mode` | A consultar → «Precio a consultar» |

Grupos: Identidad / Dimensiones / Motorización / Administrativo. El vídeo horizontal (16:9) conserva su proporción.

## Ficha de casa (punto verde)

| Campo | Ejemplo de prueba |
|---|---|
| `category` | Casa |
| `property_type` · `built_period` | Masía · años 60 |
| `area_value` · `area_unit` · `plot_area` | 320 · m² · 5200 |
| `bedrooms` · `bathrooms` | 5 · 3 |
| `energy_rating` | solo si lo aporta el propietario |
| `region` · `city` · `location_precision` | Mallorca · Pueblo de prueba · **Ciudad** (solo con autorización) |
| `area_band` · `bedrooms_band` | 250-499 m² · 5 o más |

**Nunca** pongas la dirección exacta en ningún campo público. Precisión «Ciudad» solo si el propietario y el equipo lo han decidido.

## Pasar una pieza a Reservado o Vendido

1. Cambia `sidonia.status` a `Reservado` o `Vendido`.
2. Las colecciones inteligentes la mueven solas (los vendidos pasan a `archivo`).
3. La ficha muestra el estado, oculta el precio si es `Vendido` y cambia «Consultar» por «Buscar algo parecido».
4. Un vendido puede conservarse solo si el propietario lo autoriza; si no, **despublícalo**.

## Checklist antes de publicar una pieza

- [ ] Portada con punto focal y texto alternativo.
- [ ] Vídeo en `sidonia.video` (o URL externa) y, si se tiene, subtítulos y transcripción.
- [ ] `reference`, `category`, `status`, `price_mode`.
- [ ] Ubicación solo con la precisión autorizada.
- [ ] Ningún dato personal en ningún campo ni documento.
- [ ] Inventario 0, «seguir vendiendo» desactivado, solo Tienda online.
- [ ] Vista previa en móvil y escritorio.
