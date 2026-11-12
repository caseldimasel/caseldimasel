# 03 · Sistema de diseño

## Paleta piedra

| Token CSS | Ajuste del tema | Valor inicial | Uso |
|---|---|---|---|
| `--sidonia-bg` | Sidonia · Colores › Fondo | `#F5F3EE` | Fondo de todas las páginas (también las de Impact, vía el puente) |
| `--sidonia-surface` | › Superficie | `#FAF8F4` | Tarjetas de resumen, formularios, cajones y paneles |
| `--sidonia-alt` | › Superficie alternativa | `#EAE6DE` | Bandas alternas, pie |
| `--sidonia-text` | › Texto | `#252723` | Texto principal, botón principal |
| `--sidonia-muted` | › Texto secundario | `#62635C` | Metadatos, ayudas |
| `--sidonia-line` | › Borde suave | `#D7D2C8` | Separadores **decorativos** (no transmiten información) |
| `--sidonia-control` | › Borde de controles | `#8A857B` | Borde de campos y controles (≥ 3:1) |
| `--sidonia-garage` / `harbor` / `estate` | Sidonia · Categorías › Color | `#B63F38` / `#28638E` / `#347455` | Solo el punto de categoría (decorativo: el nombre lleva el significado) |

Ajustes en **Personalizar > Ajustes del tema > Sidonia · Colores**. Con «Sidonia · Integración con Impact > Aplicar la paleta
piedra» activado, el fondo, texto, cabecera, pie (piedra alterna), cajones, tarjetas y botón principal de **Impact** usan estos
mismos valores. Desactivándolo, Impact vuelve a sus colores de *Ajustes del tema > Colores* (blanco y negro en la tienda actual).

### Contraste medido (WCAG 2.2)

Calculado con `node tools/contrast.mjs` sobre `tools/palette.mjs` (texto: mínimo 4,5:1; componentes y gráficos: 3:1).

<!-- contraste -->
| Primer plano | Fondo | Ratio | Mínimo | Cumple | Uso |
|---|---|---|---|---|---|
| texto `#252723` | fondo `#F5F3EE` | 13.59:1 | 4.5:1 | sí | Texto principal |
| texto `#252723` | superficie `#FAF8F4` | 14.21:1 | 4.5:1 | sí | Texto sobre tarjetas y formularios |
| texto `#252723` | alterno `#EAE6DE` | 12.11:1 | 4.5:1 | sí | Texto sobre bandas alternas |
| secundario `#62635C` | fondo `#F5F3EE` | 5.48:1 | 4.5:1 | sí | Texto secundario (metadatos, ayudas) |
| secundario `#62635C` | superficie `#FAF8F4` | 5.72:1 | 4.5:1 | sí | Texto secundario sobre superficie |
| secundario `#62635C` | alterno `#EAE6DE` | 4.88:1 | 4.5:1 | sí | Texto secundario sobre banda alterna |
| superficie `#FAF8F4` | texto `#252723` | 14.21:1 | 4.5:1 | sí | Texto de botón principal (oscuro) |
| error `#9B2C22` | fondo `#F5F3EE` | 6.82:1 | 4.5:1 | sí | Mensajes de error |
| error `#9B2C22` | superficie `#FAF8F4` | 7.13:1 | 4.5:1 | sí | Mensajes de error en formularios |
| correcto `#2F6A4C` | superficie `#FAF8F4` | 6.02:1 | 4.5:1 | sí | Confirmación de envío |
| control `#8A857B` | fondo `#F5F3EE` | 3.31:1 | 3:1 | sí | Borde de campos y controles (componente de interfaz) |
| control `#8A857B` | superficie `#FAF8F4` | 3.46:1 | 3:1 | sí | Borde de campos sobre superficie |
| coches `#B63F38` | fondo `#F5F3EE` | 5.04:1 | 3:1 | sí | Punto rojo «Coches» (gráfico; el nombre lleva el significado) |
| barcos `#28638E` | fondo `#F5F3EE` | 5.80:1 | 3:1 | sí | Punto azul «Barcos» |
| casas `#347455` | fondo `#F5F3EE` | 5.02:1 | 3:1 | sí | Punto verde «Casas» |
| coches `#B63F38` | alterno `#EAE6DE` | 4.49:1 | 3:1 | sí | Punto rojo sobre banda alterna |
| barcos `#28638E` | alterno `#EAE6DE` | 5.17:1 | 3:1 | sí | Punto azul sobre banda alterna |
| casas `#347455` | alterno `#EAE6DE` | 4.47:1 | 3:1 | sí | Punto verde sobre banda alterna |
| borde `#D7D2C8` | fondo `#F5F3EE` | 1.36:1 | 1:1 | sí | Separadores DECORATIVOS (no transmiten información; los controles usan «control») |
<!-- /contraste -->

Consecuencias de diseño:

- El borde suave `#D7D2C8` (1,36:1) solo separa; los campos y botones secundarios usan `#8A857B` (≥ 3,3:1).
- Los colores de categoría nunca son texto pequeño ni el único indicador: siempre van junto al nombre.
- Sobre imagen o vídeo el texto es blanco con degradado oscuro ajustable («Oscurecido para contraste», 20–80 %).

## Tipografía

- Por defecto el kit **hereda las fuentes de Impact** (`--sidonia-font-*: inherit`): hoy Lato (texto) y Carlito (títulos).
- *Sidonia · Marca y tipografía* permite usar la fuente del sistema o dos fuentes de la biblioteca de Shopify
  (licencia incluida). No se usan fuentes de Apple (sin licencia web).
- Escala de títulos ajustable (`Escala de títulos`, 80–130 %); tamaños fluidos con `clamp()`.

## Espacio, forma y capas

| Grupo | Tokens |
|---|---|
| Espacio (base 4 px) | `--sidonia-s1` … `--sidonia-s20`; márgenes `--sidonia-gutter` (16–48 px); `--sidonia-section-y` |
| Anchos | `--sidonia-page-width` (ajuste, 1440 px), `--sidonia-narrow` (46 rem) |
| Radios | `--sidonia-radius` (ajuste, 12 px), `--sidonia-radius-control`, `--sidonia-radius-pill` |
| Sombras | `--sidonia-shadow-1`, `--sidonia-shadow-2` (discretas) |
| Capas | `--sidonia-z-sticky` (5 sobre Impact, por debajo de su cabecera), `--sidonia-z-modal`, `--sidonia-z-toast` |
| Movimiento | `--sidonia-d1` 150 ms, `--sidonia-d2` 220 ms, curva `--sidonia-ease`; anulado con `prefers-reduced-motion` |
| Cabecera | `--sidonia-header-h` = altura real de la cabecera de Impact (`--header-height`) |

## Punto de categoría

8 px, sólido, separado 8 px del texto, alineado ópticamente con la línea de base; en modo de alto contraste del sistema
lleva borde. Componentes: `sidonia-cat-label` (punto + nombre), `sidonia-menu-dot` (menú de Impact), regla generada por
categoría en `sidonia-head` (añadir una categoría no exige CSS).

## Reglas de aislamiento

- Todo selector del kit contiene `sidonia` (lo comprueba `tools/check-kit.mjs`); `:root` solo define `--sidonia-*`.
- No hay reseteos globales: las secciones Sidonia usan `.sidonia-scope`; las apps y secciones de Impact no se ven afectadas.
- El único lugar que toca variables de Impact es `snippets/sidonia-impact-bridge.liquid`, controlado por un ajuste.
