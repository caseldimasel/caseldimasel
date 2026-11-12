// Impact 7.x · piezas Sidonia dentro de los componentes de Impact.
// Una pieza Sidonia es un producto con el metacampo sidonia.category relleno. El comercio normal (libros, láminas,
// coches a escala…) no cambia: estas condiciones solo actúan cuando ese metacampo existe.
//  1. card-swap  (snippets/product-card.liquid): las secciones de Impact que listan productos (colección destacada,
//     relacionados, vistos recientemente, búsqueda, mega menú) pintan sidonia-card para las piezas Sidonia.
//  2. price-guard (snippets/price-list.liquid): donde Impact pinta un precio de producto o de variante (búsqueda
//     predictiva, producto destacado, producto horizontal…), una pieza Sidonia muestra su precio editorial
//     (importe publicado, «Precio a consultar», «Precio no publicado» o «Vendida»), nunca el precio técnico 0.
//  3. buy-guard (snippets/buy-buttons.liquid): si una pieza Sidonia acaba en una sección de producto de Impact,
//     no se pintan los botones de compra. Esto es solo interfaz: el bloqueo real de la compra es la configuración
//     de inventario documentada en docs/10-precios-y-compra.md.
import { isImpact7, editFile, mark } from './_lib.mjs';

export const appliesTo = isImpact7;

export function apply(dir) {
  const modified = [];
  if (
    editFile(dir, 'snippets/product-card.liquid', 'card-swap', (src) =>
      `${mark('card-swap')}{%- if product.metafields.sidonia.category != blank -%}
  {%- comment -%} Pieza Sidonia: tarjeta del kit (integration/patches/20-impact-commerce.mjs) {%- endcomment -%}
  {%- liquid
    assign sidonia_priority = false
    if position == 1 or position == 2
      assign sidonia_priority = true
    endif
  -%}
  {%- render 'sidonia-card', product: product, priority: sidonia_priority, class: 'sidonia-card--in-impact' -%}
{%- else -%}
${src}
{%- endif -%}
`
    )
  )
    modified.push('snippets/product-card.liquid (tarjeta Sidonia para piezas con sidonia.category)');

  if (
    editFile(dir, 'snippets/price-list.liquid', 'price-guard', (src) =>
      `${mark('price-guard')}{%- liquid
  assign sidonia_price_product = product
  if sidonia_price_product == blank and variant != blank
    assign sidonia_price_product = variant.product
  endif
  assign sidonia_price_on = false
  if line_item == blank and sidonia_price_product.metafields.sidonia.category != blank
    assign sidonia_price_on = true
  endif
-%}
{%- if sidonia_price_on -%}
  {%- comment -%} Pieza Sidonia: precio editorial (integration/patches/20-impact-commerce.mjs) {%- endcomment -%}
  <price-list class="price-list {% if size == 'lg' %}price-list--lg{% endif %}"><span class="sidonia-price-in-impact">{%- render 'sidonia-price', product: sidonia_price_product -%}</span></price-list>
{%- else -%}
${src}
{%- endif -%}
`
    )
  )
    modified.push('snippets/price-list.liquid (precio editorial para piezas Sidonia; nunca 0)');

  if (
    editFile(dir, 'snippets/buy-buttons.liquid', 'buy-guard', (src) =>
      `${mark('buy-guard')}{%- if product.metafields.sidonia.category == blank -%}
${src}
{%- endif -%}
`
    )
  )
    modified.push('snippets/buy-buttons.liquid (sin botones de compra para piezas Sidonia)');
  return { modified };
}
