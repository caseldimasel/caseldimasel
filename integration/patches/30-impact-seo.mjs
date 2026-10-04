// Impact 7.x · SEO de las piezas Sidonia.
//  1. snippets/microdata-schema.liquid: Impact emite `product | structured_data` (oferta con el precio técnico de la
//     variante y disponibilidad de compra). Para una pieza Sidonia se omite: la ficha Sidonia emite su propio JSON-LD
//     (sidonia-structured-data) sin oferta comprable por defecto ni precio 0. Las migas de Impact se conservan.
//  2. snippets/social-meta-tags.liquid: Impact publica product:price:amount con el precio de la variante y
//     product:availability «out of stock». Para una pieza Sidonia se omiten (precio técnico y stock no significan nada).
import { isImpact7, editFile, replaceExact, mark } from './_lib.mjs';

export const appliesTo = isImpact7;

export function apply(dir) {
  const modified = [];
  const ms = 'snippets/microdata-schema.liquid';
  if (
    editFile(dir, ms, 'seo-guard', (src) =>
      mark('seo-guard') +
      '\n' +
      replaceExact(
        src,
        "{%- if request.page_type == 'product' -%}\n  <script type=\"application/ld+json\">\n    {{- product | structured_data -}}",
        "{%- if request.page_type == 'product' and product.metafields.sidonia.category == blank -%}\n  <script type=\"application/ld+json\">\n    {{- product | structured_data -}}",
        1,
        ms
      )
    )
  )
    modified.push(`${ms} (sin JSON-LD de oferta de Impact en piezas Sidonia)`);

  const og = 'snippets/social-meta-tags.liquid';
  const anchor =
    '  <meta property="product:price:amount" content="{{ product.selected_or_first_available_variant.price | money_without_currency | strip_html | escape }}">\n  <meta property="product:price:currency" content="{{ cart.currency.iso_code }}">\n  <meta property="product:availability" content="{% if product.available %}in stock{% else %}out of stock{% endif %}">';
  if (
    editFile(dir, og, 'og-guard', (src) =>
      mark('og-guard') + '\n' + replaceExact(src, anchor, '  {%- if product.metafields.sidonia.category == blank -%}\n' + anchor + '\n  {%- endif -%}', 1, og)
    )
  )
    modified.push(`${og} (sin og:price ni disponibilidad técnica en piezas Sidonia)`);
  return { modified };
}
