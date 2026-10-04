# Parches específicos de Impact (pendientes)

Esta carpeta contendrá los parches que adaptan archivos **propios de Impact** (cabecera, menú, búsqueda predictiva, JSON-LD, colores). **Están vacíos a propósito**: no se pueden escribir sin ver los archivos reales de la versión de Impact de Sidonia, y el briefing prohíbe inventar nombres de snippets, ajustes o eventos.

Cuando llegue la copia de Impact:

1. `node integration/audit-impact.mjs impact/<copia>.zip` → `impact/AUDITORIA.md`.
2. Para cada punto de `integration/manifest.json › patches_pending`, se escribe aquí un módulo `NN-<id>.mjs`:

```js
// Ejemplo de contrato (no es código de Impact)
export function appliesTo(themeDir) { /* true si el archivo esperado existe */ }
export function apply(themeDir) {
  // Lee el archivo real, inserta el render del kit en el punto localizado por la auditoría
  // entre marcas {%- comment -%}sidonia:<id>{%- endcomment -%} para que sea idempotente y fácil de revisar,
  // y devuelve { modified: ['sections/<archivo-real>.liquid'] }.
}
```

3. `node integration/apply-kit.mjs --base impact/original --out impact/sidonia --replace index.json,search.json,404.json` aplica kit + parches y deja el registro y el diff.

| Parche | Qué hará | Dónde se localiza |
|---|---|---|
| `header-actions` | Favoritos con contador y «Vender con Sidonia» en la cabecera | Auditoría §3 |
| `menu-dots` | Punto de color delante de Coches, Barcos y Casas (menú de escritorio y móvil) | Auditoría §3 |
| `transparent-header` | `sidonia-hero` y `sidonia-page-header` activan la cabecera transparente nativa | Auditoría §3 |
| `seo-guard` | Sin JSON-LD de oferta ni `og:price` de variante en las fichas Sidonia | Auditoría §5 |
| `predictive-price` | La búsqueda predictiva muestra el precio editorial, nunca 0 | Auditoría §6 |
| `card-swap` | Las secciones de Impact que listen piezas usan `sidonia-card` | Auditoría §4 |
| `color-bridge` | Tokens `--sidonia-*` enlazados con las variables reales y fondo piedra en Impact | Auditoría §7 |

Cada parche debe ir acompañado de una entrada en `docs/14-registro-de-cambios.md` con el archivo de Impact tocado, la línea de anclaje y el motivo, para revisarlo al actualizar Impact.
