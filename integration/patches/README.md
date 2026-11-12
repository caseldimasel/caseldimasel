# Parches para Impact 7.x

Escritos tras auditar la copia real de la tienda (Impact **7.2.0**, exportación del 4/10/2026; `node integration/audit-impact.mjs`).
`integration/apply-kit.mjs` los aplica en orden sobre la **copia** del tema, nunca sobre el original.

## Reglas

- Cada cambio se localiza con un **ancla exacta** de Impact 7.2.0 y comprueba cuántas veces aparece. Si no coincide (otra
  versión de Impact), el parche **se detiene** con un mensaje que dice qué ancla falta: nunca se aplica a ciegas.
- Cada archivo modificado lleva la marca `sidonia:<id>` (idempotente: no se aplica dos veces) y un comentario que dice qué parche lo cambió.
- Solo actúan sobre las **piezas** (productos con `sidonia.category`); el comercio normal de la tienda no cambia.
- No tocan `config/settings_data.json`.

| Parche | Archivos de Impact | Qué hace |
|---|---|---|
| `10-impact-header.mjs` | `sections/header.liquid`, `snippets/navigation-panel.liquid` | Puntos de categoría en el menú (escritorio y móvil); Favoritos y «Vender con Sidonia» en la cabecera; «Favoritos» en el panel móvil; logo sin `<h1>` en la portada (el hero ya tiene el h1) |
| `20-impact-commerce.mjs` | `snippets/product-card.liquid`, `price-list.liquid`, `buy-buttons.liquid` | Tarjeta Sidonia, precio editorial y sin botones de compra para piezas |
| `30-impact-seo.mjs` | `snippets/microdata-schema.liquid`, `social-meta-tags.liquid` | Sin JSON-LD comprable de Impact ni `og:price`/disponibilidad técnica en piezas |
| `40-impact-bridge.mjs` | `layout/theme.liquid`, `config/settings_schema.json` + nuevo `snippets/sidonia-impact-bridge.liquid` | Altura real de la cabecera para el kit y paleta piedra en todo Impact (casilla «Aplicar la paleta piedra») |
| `50-impact-templates.mjs` | `templates/index.json`, `search.json`, `404.json`, `sections/footer-group.json`, `header-group.json` | Secciones originales conservadas desactivadas; «Sidonia · Pie»; cabecera fija y logo a la izquierda |

La cabecera transparente **no** se parchea: `sidonia-hero` y `sidonia-page-header` usan el mecanismo de Impact
(`allow-transparent-header` + margen superior negativo, verificado en `assets/theme.js › StoreHeader`).

## Contrato de un parche

```js
export function appliesTo(themeDir) { return isImpact7(themeDir); }
export function apply(themeDir, { base, root, update }) {
  // editFile(themeDir, 'snippets/x.liquid', 'id', (src) => replaceExact(src, ANCLA, NUEVO, VECES, 'snippets/x.liquid'))
  return { modified: ['snippets/x.liquid (motivo)'], created: [], notes: [] };
}
```

Utilidades en `_lib.mjs` (los archivos que empiezan por `_` no se ejecutan como parche).
