# 00 · Decisiones, supuestos y requisitos trazables

## Decisiones esenciales (15 líneas)

1. **Base:** la copia licenciada de **Impact 7.2.0** de la tienda (exportación del 4/10/2026), en un **duplicado sin publicar**. Nada de tema propio, Dawn ni headless.
2. **Método:** kit `sidonia-*` (secciones, snippets, CSS, JS) + **5 parches pequeños** sobre archivos de Impact, aplicados por script con anclas exactas y registro de cambios. `settings_data.json` no se toca.
3. **Cabecera transparente:** el mecanismo **nativo de Impact** (`allow-transparent-header`, verificado en `theme.js › StoreHeader`). El hero Sidonia se declara compatible; no hay un segundo sistema de cabecera.
4. **Categorías públicas:** Coches (rojo `#B63F38`), Barcos (azul `#28638E`), Casas (verde `#347455`); claves internas `garage`, `harbor`, `estate`; comunidades SIDONIA GARAGE / HARBOR / ESTATE como texto secundario opcional.
5. **Piedra en todo el tema:** tokens Sidonia + un **puente** que redefine las variables de color de Impact (desactivable con una casilla). Contrastes medidos ([03](03-sistema-de-diseno.md)).
6. **Pieza = producto de Shopify** con metacampos `sidonia.*`. Lo que la distingue de un producto normal es `sidonia.category`: el comercio actual (libros, láminas, coches a escala) **no cambia**.
7. **Precio editorial separado del precio de variante:** «85.000 €», «Precio a consultar», «Precio no publicado» o «Vendida». Nunca 0, tampoco en buscador ni JSON-LD.
8. **Filtros reales** de Shopify/Search & Discovery: 16 de 25; números en **bandas de texto** porque los filtros numéricos de metacampo son por valor exacto.
9. **Un único formulario de venta** en 3 pasos sobre el formulario de contacto nativo; preselección validada con `?categoria=`; los campos de otras categorías no se envían.
10. **Vídeo:** portada primero, sonido solo tras pulsar, un único vídeo con sonido, vertical sin recortar, sin vídeos en la carga del listado.
11. **Redes:** metaobjeto `sidonia_social_account`; el total se **calcula** (sin duplicados, vacío ≠ 0, aclaración «Suma de seguidores…»).
12. **Propietario:** nombre público solo con autorización (casilla); si no, descripción real; nunca datos de contacto.
13. **Favoritos anónimos** en el navegador, revalidados contra la tienda al abrir la página.
14. **Cabecera de Impact:** en el duplicado se activa «cabecera fija» y el diseño «logo a la izquierda, navegación en línea» (más cercano a JamesEdition). Ambos se revierten en el editor.
15. **Repositorio público:** el código de Impact, el tema integrado, el ZIP y el diff **no** se suben; solo el trabajo propio.

## Supuestos

| Supuesto | Consecuencia | Cómo cambiarlo |
|---|---|---|
| El idioma de la tienda es español; Impact tiene `en.default.json` como idioma por defecto del tema | Las cadenas `sidonia.*` se copian en `es.json` **y** en `en.default.json` | Traducir en *Contenido > Traducciones* si se publica otro idioma |
| Las piezas se venden fuera del checkout | Sin carrito ni compra en sus fichas; inventario 0 sin vender sin existencias ([10](10-precios-y-compra.md)) | — |
| El formulario de contacto nativo es suficiente en la primera versión | Las solicitudes llegan al correo de la tienda | Integración con CRM en [17](17-fase-2.md) |
| La colección actual `coches-en-venta` y los productos con plantilla `product.cars` son anuncios reales | No se borran ni se cambian; se proponen pasos de migración ([02](02-instalacion.md) §6) | — |
| Las páginas «vende tu casa» usan la app *Powerful Form Builder* | Se conservan; el CTA nuevo apunta a `/pages/vender-con-sidonia` | Redirección si se decide retirar las antiguas |
| Faltan logos definitivos, cuentas, cifras, vídeos, fichas y textos legales | Ajustes vacíos, estados vacíos cuidados; nada inventado ([13](13-datos-pendientes.md)) | Rellenar desde el editor |
| JamesEdition no se pudo abrir desde el entorno (red bloqueada) | Los patrones se describen sin afirmar una revisión visual ([01](01-patrones-jamesedition.md)) | Revisión en navegador antes de publicar |

## Requisitos trazables

| # | Requisito del encargo | Componente (Impact o nuevo) | Archivo real | Cómo se comprueba |
|---|---|---|---|---|
| 1 | Base Impact, duplicado sin publicar | Impact 7.2.0 + kit | `impact/original` → `impact/sidonia` (local) | `audit-impact.mjs`; `apply-kit.mjs` no modifica el original; ZIP con carpetas en la raíz |
| 2 | Cercanía a JamesEdition | Cabecera de Impact (logo izq.), `sidonia-hero`, `sidonia-catalog`, `sidonia-card`, `sidonia-listing` | `sections/header-group.json`, `kit/sections/*` | Capturas 01–09; pruebas §2–§5 |
| 3 | Acabado Apple | Tokens y movimiento 150–220 ms, `prefers-reduced-motion` | `kit/assets/sidonia-base.css` | Prueba «Movimiento reducido» |
| 4 | Fondo piedra en todo | Tokens + puente de colores de Impact | `snippets/sidonia-impact-bridge.liquid` | Capturas (carrito, búsqueda, 404, producto normal); casilla «Aplicar la paleta piedra» |
| 5 | Cabecera transparente / sólida | Mecanismo nativo de Impact + `sidonia-hero` | `sections/sidonia-hero.liquid` (atributo y margen), `header-group.json` (fija) | Pruebas §3: transparente, sólida al bajar, misma altura, sólida al pasar el ratón; sin JS |
| 6 | Coches · Barcos · Casas con punto | `sidonia-menu-dot`, `sidonia-cat-label`, ajustes de categoría | Parche `10-impact-header.mjs` (menú escritorio y móvil) | Prueba «Nombres públicos exactos y puntos de color» |
| 7 | Un único formulario de venta | `sidonia-sell-form` + `sidonia-forms.js` | `templates/page.sell.json` | Pruebas §7: pasos, preselección, campos enviados, red, anti-spam, sin JS |
| 8 | Redes y total calculado | `sidonia-social`, `sidonia-community`, metaobjeto | `kit/snippets/sidonia-social.liquid` | Pruebas §8: 20.700 = 12.400 + 8.300, duplicada fuera, sin cifra ≠ 0, estado vacío |
| 9 | Ficha: precio, descripción, detalles, propietario, ubicación | `sidonia-listing` y módulos | `templates/product.garage/harbor/estate.json` | Prueba §5 «La ficha muestra…»; capturas 06–11 |
| — | Comercio normal intacto | Impact sin cambios para productos sin `sidonia.category` | Parche `20-impact-commerce.mjs` | Página `/products/prueba-libro` con precio y «Añadir a la cesta»; captura 18 |
| — | Sin precio 0 ni oferta comprable | `sidonia-price`, guardas de Impact | Parches `20` y `30` | Pruebas «Precios» y «Datos estructurados» |
| — | Accesibilidad y responsive | HTML semántico, foco, `aria-*`, 5 anchos | Todo el kit | Pruebas §1 y §9 |
| — | Analítica sin datos personales | `S.track` con lista blanca y consentimiento | `kit/assets/sidonia-core.js` | Pruebas §9 |
