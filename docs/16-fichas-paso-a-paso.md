# 16 · Fichas paso a paso: coche, barco y casa

Requisito previo: definiciones de metacampos creadas ([04](04-modelo-de-datos.md)) y colecciones automáticas ([06](06-colecciones-y-filtros.md)).

## Pasos comunes (las tres)

1. **Productos > Añadir producto.** Título: el nombre de la pieza («Alfa Romeo Giulia GT 1300 Junior»). Descripción: un
   resumen comprensible de 2–4 frases (es lo que leen buscadores y redes).
2. **Multimedia:** la portada primero (horizontal, buena luz; ajusta el **punto focal**). Opcional: el vídeo en Multimedia si no usas el metacampo.
3. **Precio de la variante:** déjalo en 0 o pon el precio real si vas a activar el orden por precio ([10](10-precios-y-compra.md)); no se muestra.
4. **Inventario:** «Controlar cantidad» activado, cantidad **0**, «Seguir vendiendo sin existencias» **desactivado**. Sin variantes.
5. **Canales:** solo Tienda online.
6. **Plantilla del tema:** `product.garage` (coche), `product.harbor` (barco) o `product.estate` (casa).
7. **Metacampos comunes** (panel «Metacampos» del producto):
   - Referencia (p. ej. `SG-2026-014`), **Categoría** (Coches/Barcos/Casas), **Estado de venta** (Disponible).
   - Gancho editorial (una línea), Qué la hace especial, Hechos destacados, Historia (texto enriquecido), Procedencia.
   - **Ubicación:** país, región, ciudad y precisión (Ciudad/Región/País). Dónde está **hoy**.
   - **Propietario:** nombre público y «Mostrar el nombre» solo con autorización; si no, «Descripción del propietario» (p. ej. «Propietario particular»); historia pública opcional.
   - **Precio:** modo (Publicado / A consultar / No publicado), importe (si Publicado), moneda (EUR).
   - **Vídeo:** archivo principal (Contenido > Archivos), clip breve, duración (s), idioma, subtítulos .vtt, transcripción, publicación original en redes.
   - Estado y observaciones, trabajos realizados, documentos públicos, cronología (metaobjetos), relacionadas, **destacada en portada**.
   - **Banda de presupuesto** (vacía si «A consultar» o «No publicado»).
8. **SEO** (*Ficha en buscadores*): título y descripción propios.
9. Guarda, abre la **vista previa del duplicado** y revisa la ficha y su tarjeta en la colección.

## Coche — datos propios

| Campo | Ejemplo de prueba | Nota |
|---|---|---|
| Marca / Modelo / Versión | Marca A / Modelo A / Versión A | Escribe la marca siempre igual (es filtro) |
| Año | 1972 | + **Banda de año** «1970-1979» |
| Kilometraje (km) | 84000 | Vacío si no se conoce (0 se publica como «0 km»); + banda «50.000-99.999 km» |
| Combustible / Cambio | Gasolina / Manual | Filtros |
| Potencia (CV) / Color | 130 / Rojo | Solo si se conocen |

No publiques la matrícula completa ni el número de bastidor.

## Barco — datos propios

| Campo | Ejemplo de prueba | Nota |
|---|---|---|
| Constructor / Modelo | Constructor A / Modelo náutico A | Filtro «Constructor» |
| Tipo de embarcación | Velero | Filtro |
| Año | 1988 | + banda de año |
| Eslora / Manga (m) | 12.5 / 3.8 | Se muestran «12,5 m»; + **banda de eslora** «12-14,99 m» |
| Motorización / Horas de motor | Diésel 40 CV / 2100 | Solo si se conocen |
| Régimen fiscal declarado | IVA pagado (declarado) | Solo si es pertinente y está confirmado |

## Casa — datos propios

| Campo | Ejemplo de prueba | Nota |
|---|---|---|
| Tipo de inmueble | Masía | Filtro |
| Superficie / Unidad | 320 / m² | + banda «250-499 m²» |
| Parcela (m²) | 5200 | Solo si existe |
| Dormitorios / Baños | 5 / 3 | + banda de habitaciones «5 o más» |
| Época de construcción | Años 60 | Texto libre conocido |
| Certificación energética | E | Solo si se aporta |
| Ubicación | Mallorca · Pueblo · precisión «Ciudad» o «Región» | **Nunca** la dirección exacta |

## Cuando se reserva o se vende

- Reservada: Estado de venta → **Reservado** (etiqueta visible; sigue aceptando consultas).
- Vendida: Estado → **Vendido**. Desaparece de destacadas y relacionadas, entra en el archivo, muestra «Vendida» y
  «Busco algo parecido» en lugar de «Me interesa». Si no está autorizado conservarla, archívala o despublícala.
