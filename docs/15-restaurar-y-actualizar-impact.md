# 15 · Restaurar y actualizar Impact

## Restaurar

| Situación | Qué hacer |
|---|---|
| Algo no gusta en el duplicado | No pasa nada en la tienda: el duplicado está sin publicar. Corrige en el editor o bórralo |
| Volver a la versión de partida | Sube de nuevo el ZIP original de Impact (la exportación del 4/10/2026) como tema nuevo; o vuelve a ejecutar `apply-kit` desde `impact/original` |
| Ya publicado y hay que volver atrás | *Temas > biblioteca > tema anterior > Publicar* (Shopify conserva el tema anterior en la biblioteca). Exporta una copia antes de publicar |
| Quitar solo la paleta piedra | *Ajustes del tema > Sidonia · Integración con Impact > Aplicar la paleta piedra* → desactivar |
| Quitar un parche concreto | Los cambios van entre marcas `sidonia:<id>` y están en `impact/sidonia.diff`; borra el bloque marcado o reintegra sin ese archivo de `integration/patches/` |
| Recuperar la portada anterior | En el editor, activa las secciones `impact_…` del final de la portada |

Antes de publicar: **exporta el tema publicado actual** (*⋯ > Descargar archivo del tema*) y guarda la copia fuera de Shopify.

## Actualizar Impact a una versión nueva

Shopify no aplica actualizaciones de un tema personalizado de forma automática y sin conflictos. Procedimiento:

1. Descarga la versión nueva de Impact (actualización desde la tienda de temas, que crea una copia nueva) y su exportación ZIP.
2. `node integration/audit-impact.mjs impact/impact-nuevo.zip` y compara `impact/AUDITORIA.md` con la anterior
   (cabecera transparente, tarjeta, precios, JSON-LD, búsqueda predictiva, colores).
3. `node integration/apply-kit.mjs --base impact/impact-nuevo --out impact/sidonia-nuevo --replace index.json,search.json,404.json`.
   - Si un parche no encuentra su ancla, **se detiene** y dice cuál («el ancla aparece 0 veces…»): revisa ese archivo de Impact,
     ajusta el ancla en `integration/patches/NN-…mjs` y repite. Nunca se aplica a ciegas.
   - Los parches comprueban «Impact 7.x»; para Impact 8 hay que revisarlos uno a uno.
4. `node tools/check-kit.mjs --theme impact/sidonia-nuevo` y `node tools/harness/tests/e2e.mjs`.
5. Sube el ZIP como tema nuevo sin publicar y repasa la lista de [02](02-instalacion.md) §7.
6. **Ajustes y contenido:** el ZIP de Impact nuevo no trae tus ajustes. Copia `config/settings_data.json` y las plantillas
   JSON editadas del duplicado anterior (exportación del duplicado) o vuelve a configurarlos en el editor.

## Archivos de Impact modificados (lo que hay que revisar al actualizar)

| Archivo | Parche | Qué cambia |
|---|---|---|
| `layout/theme.liquid` | apply-kit, 40 | 3 líneas antes de `</head>`/`</body>` entre marcas |
| `sections/header.liquid` | 10 | Punto de categoría en 4 enlaces de primer nivel; Favoritos y «Vender» en los iconos; logo sin `<h1>` en la portada |
| `snippets/navigation-panel.liquid` | 10 | Puntos y «Favoritos» en el panel móvil |
| `snippets/product-card.liquid` | 20 | Envuelto: tarjeta Sidonia si la pieza tiene `sidonia.category` |
| `snippets/price-list.liquid` | 20 | Envuelto: precio editorial para piezas |
| `snippets/buy-buttons.liquid` | 20 | Envuelto: sin compra para piezas |
| `snippets/microdata-schema.liquid` | 30 | Condición añadida al JSON-LD de producto |
| `snippets/social-meta-tags.liquid` | 30 | Condición alrededor de `og:price` y disponibilidad |
| `config/settings_schema.json` | apply-kit, 40 | Grupos «Sidonia · …» añadidos al final |
| `locales/en.default.json`, `locales/es.json` | apply-kit | Clave `sidonia` añadida |
| `templates/index.json`, `search.json`, `404.json` | apply-kit, 50 | Del kit + secciones originales desactivadas |
| `sections/header-group.json`, `footer-group.json` | 50 | Cabecera fija y logo a la izquierda; «Sidonia · Pie» delante del pie |

Todo lo demás de Impact queda idéntico (lo confirma `impact/sidonia.diff`).
