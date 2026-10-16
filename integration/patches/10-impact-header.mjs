// Impact 7.x · cabecera (sections/header.liquid) y panel de navegación móvil (snippets/navigation-panel.liquid).
//  1. menu-dots: punto rojo/azul/verde delante de Coches, Barcos y Casas en el menú de escritorio (4 variantes
//     de enlace de primer nivel que pinta Impact) y en el panel móvil (2 variantes).
//  2. header-actions: Favoritos (con contador) delante del carrito y «Vender con Sidonia» al final de los iconos.
//     En móvil el corazón de la cabecera se oculta (no cabe junto al logo centrado de Impact) y «Favoritos»
//     aparece al final del panel de navegación.
//  3. logo: en la portada Impact envuelve el logo en <h1>; el hero Sidonia ya tiene el <h1> de la página,
//     así que el logo pasa a <div> con la misma clase (mismo aspecto, una sola cabecera de nivel 1).
// La cabecera transparente NO se parchea: sidonia-hero y sidonia-page-header usan el mecanismo nativo de Impact
// (atributo allow-transparent-header + margen superior negativo), verificado en assets/theme.js (StoreHeader).
import { isImpact7, editFile, replaceExact, mark } from './_lib.mjs';

export const appliesTo = isImpact7;

export function apply(dir) {
  const modified = [];
  const header = 'sections/header.liquid';
  const changed = editFile(dir, header, 'header', (src) => {
    let s = src;
    // 1. puntos de categoría en los 4 enlaces de primer nivel
    s = replaceExact(s, '{{- link.title -}}', "{%- render 'sidonia-menu-dot', link: link -%}{{- link.title -}}", 4, header);
    // 2a. Favoritos delante del carrito
    s = replaceExact(
      s,
      '          <li>\n            <a\n              href="{{ routes.cart_url }}"',
      "          <li class=\"sidonia-impact-icon\">\n            {%- render 'sidonia-header-actions', show_sell: false -%}\n          </li>\n\n          <li>\n            <a\n              href=\"{{ routes.cart_url }}\"",
      1,
      header
    );
    // 2b. «Vender con Sidonia» tras el carrito
    s = replaceExact(
      s,
      '          </li>\n        </ul>\n      </div>\n    </div>\n  </store-header>',
      "          </li>\n\n          <li class=\"sidonia-impact-sell\">\n            {%- render 'sidonia-header-actions', show_favorites: false -%}\n          </li>\n        </ul>\n      </div>\n    </div>\n  </store-header>",
      1,
      header
    );
    // 3. logo sin <h1> en la portada
    s = replaceExact(s, '        <h1 class="header__logo">\n', '        <div class="header__logo">\n', 1, header);
    s = replaceExact(s, '          <a href="{{ routes.root_url }}">{{ logo_content }}</a>\n        </h1>', '          <a href="{{ routes.root_url }}">{{ logo_content }}</a>\n        </div>', 1, header);
    return `${mark('header')}{%- comment -%} Modificado por Sidonia (integration/patches/10-impact-header.mjs): puntos de categoría en el menú, Favoritos, «Vender con Sidonia» y logo sin <h1> en la portada. {%- endcomment -%}\n` + s;
  });
  if (changed) modified.push(`${header} (puntos de categoría, Favoritos, «Vender con Sidonia», logo sin h1)`);

  const panel = 'snippets/navigation-panel.liquid';
  const changed2 = editFile(dir, panel, 'menu-dots', (src) => {
    let s = src;
    s = replaceExact(s, '                  <span>{{ link.title }}</span>', "                  <span>{%- render 'sidonia-menu-dot', link: link -%}{{ link.title }}</span>", 1, panel);
    s = replaceExact(s, '><span class="reversed-link">{{ link.title }}</span></span', "><span class=\"reversed-link\">{%- render 'sidonia-menu-dot', link: link -%}{{ link.title }}</span></span", 2, panel);
    // Favoritos en el panel móvil (en la barra móvil solo caben menú, búsqueda, logo, carrito y «Vender»)
    s = replaceExact(
      s,
      '          {%- endfor -%}\n        </ul>\n\n        {%- if secondary_menu != blank -%}',
      "          {%- endfor -%}\n\n          {%- unless is_mega_menu -%}\n            <li class=\"h3 sm:h4 sidonia-impact-drawer-fav\">{%- render 'sidonia-header-actions', variant: 'text' -%}</li>\n          {%- endunless -%}\n        </ul>\n\n        {%- if secondary_menu != blank -%}",
      1,
      panel
    );
    return `${mark('menu-dots')}{%- comment -%} Modificado por Sidonia (integration/patches/10-impact-header.mjs): puntos de categoría y «Favoritos» en el panel móvil. {%- endcomment -%}\n` + s;
  });
  if (changed2) modified.push(`${panel} (puntos de categoría y «Favoritos» en el menú móvil)`);
  return { modified };
}
