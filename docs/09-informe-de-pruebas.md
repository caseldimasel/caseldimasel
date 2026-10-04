# 09 · Informe de pruebas

> Generado el 2026-10-04 con `node tools/tests/e2e.mjs && node tools/tests/report.mjs`. **Léelo entero antes de fiarte de las marcas verdes**: describe qué se ha probado, con qué y qué NO se ha podido probar.

## 1. Cómo se ha probado

| Capa | Herramienta | Qué demuestra |
|---|---|---|
| Estructura, JSON, schemas, Liquid (balance de etiquetas, filtros, referencias), traducciones, contraste de la paleta | `tools/validate-theme.mjs` (propio) | El tema es coherente y no tiene referencias rotas |
| Plantillas Liquid renderizadas | `tools/preview/liquid.mjs` (**intérprete propio**, no el de Shopify) + datos de prueba `tools/preview/store.mjs` | Que las plantillas producen el HTML esperado con datos de ejemplo |
| Comportamiento en navegador | Chromium (Playwright) contra la previsualización local, 5 anchos | Layout, JS, vídeo, filtros, favoritos, formularios, accesibilidad básica |

Resultado de la última ejecución: **66 de 66 pruebas correctas**; validador: **0 errores**, 1 avisos informativos.

## 2. Lo que NO se ha podido hacer en esta entrega

Estas limitaciones son del entorno de desarrollo (sin acceso a Internet salvo el repositorio) y **no están resueltas**:

1. **Shopify Theme Check y Shopify CLI no se han ejecutado** (no se pudo instalar nada desde npm). Sustituto parcial: `validate-theme.mjs`, que **no** cubre todas las reglas de Theme Check. Ejecuta `shopify theme check --path theme` y corrige lo que aparezca.
2. **La documentación vigente de Shopify no se pudo consultar** (shopify.dev bloqueado). Todo lo que depende de ella está en la tabla del apartado 5 como «por verificar».
3. **El HTML de las pruebas lo genera un intérprete propio**, no el motor de Shopify. Puede diferir en detalles (formateo de números, espacios, filtros no usados). No se ha instalado ni probado el tema en una tienda real.
4. **No se ha comprobado la recepción real de formularios** (el correo de la tienda, las etiquetas de cliente, el comportamiento ante errores en páginas que no son `/contact`, la pantalla anti-spam de Shopify). El servidor de pruebas simula esas respuestas.
5. **No se ha probado el bloqueo de compra** (`/cart/add`, enlaces de carrito, checkout) porque no hay tienda.
6. **Solo Chromium.** No se ha probado en Safari/WebKit, Firefox ni en dispositivos reales. Los anchos 360, 390, 768, 1024 y 1440 son ventanas de Chromium, no móviles reales (táctil, teclado virtual, barra de navegador, `safe-area`).
7. **Accesibilidad**: auditoría automática propia (idioma, landmarks, ids, etiquetas, nombres, alt, encabezados, foco, contraste calculado). **No se ha probado con lector de pantalla** (VoiceOver, NVDA, TalkBack) ni con una herramienta como axe o Lighthouse. Objetivo WCAG 2.2 AA: **no certificado**.
8. **Rendimiento**: solo se midió CLS local (0,000) y se comprobó que no hay terceros ni vídeos en listados. **LCP e INP no se han medido** (no hay Lighthouse ni red real). Las metas (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1) son objetivos a medir en la tienda, no resultados.
9. **Reducción de movimiento, ahorro de datos y bloqueo de autoplay** se probaron con emulación de Chromium; la detección de ahorro de datos (`navigator.connection`) no existe en todos los navegadores.
10. **El tema se subió a Shopify cero veces**: la validación de subida (límites de nombres, tipos de ajustes, fuentes por defecto) no se ha ejecutado.

## 3. Resultados de las pruebas de navegador

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Sin desbordes ni errores a 360px (perfil completo, 17 páginas) | 17 páginas |
| ✔ | Sin desbordes ni errores a 390px (perfil completo, 17 páginas) | 17 páginas |
| ✔ | Sin desbordes ni errores a 768px (perfil completo, 17 páginas) | 17 páginas |
| ✔ | Sin desbordes ni errores a 1024px (perfil completo, 17 páginas) | 17 páginas |
| ✔ | Sin desbordes ni errores a 1440px (perfil completo, 17 páginas) | 17 páginas |
| ✔ | Sin desbordes ni errores a 360 y 1440 px (instalación vacía, sin contenido real) |  |
| ✔ | El hero comunica coches, barcos, casas y vídeo narrativo en el primer bloque |  |
| ✔ | Los dos botones principales se ven sin desplazarse a 360×640 |  |
| ✔ | Los dos botones principales se ven sin desplazarse a 390×800 |  |
| ✔ | Instalación vacía: logo en texto accesible, menú de reserva, secciones vacías ocultas y avisos solo en el editor |  |
| ✔ | Métricas: solo se publican redes con perfil y cifra; sin cifras inventadas ni sumas |  |
| ✔ | Tres mundos: el contador procede de la colección y coincide con el listado |  |
| ✔ | Tarjetas: sin botones dentro de enlaces, un enlace de ficha, destinos táctiles ≥ 44 px |  |
| ✔ | Tarjetas: estado, precio real, «Precio a consultar» y «no publicado», sin 0 ni «gratis» |  |
| ✔ | Tarjetas: duración solo si se conoce y sin vídeo no hay botón de reproducir |  |
| ✔ | Listados: no se descarga ningún vídeo ni existe <video> al cargar |  |
| ✔ | Modal: el vídeo se crea al pulsar, suena (no silenciado), Escape lo cierra, lo elimina y devuelve el foco |  |
| ✔ | Modal: botón de cerrar visible y clic en el fondo cierran; el vertical no se estira ni se recorta |  |
| ✔ | Un solo vídeo con sonido a la vez (ficha + modal) |  |
| ✔ | Ficha: vídeo vertical con reproductor junto a la información, sin audio automático y con controles tras empezar |  |
| ✔ | Ficha horizontal (16:9): se reserva proporción horizontal y no se recorta |  |
| ✔ | Previsualización silenciosa: solo en escritorio, en bucle, silenciada; ausente con reducir movimiento y en móvil |  |
| ✔ | Previsualización: si el navegador rechaza play(), no hay errores visibles y queda la portada |  |
| ✔ | Vídeo roto: mensaje útil con reintento y la ficha conserva datos y contacto |  |
| ✔ | Proveedores externos: no se carga ningún iframe hasta confirmar; se usa youtube-nocookie |  |
| ✔ | Datos estructurados válidos; oferta solo con precio publicado y pieza disponible (nunca 0, a consultar, no publicado ni vendida) |  |
| ✔ | Precio a consultar / no publicado en la ficha: ni 0 ni «gratis» ni nada comprable |  |
| ✔ | Ninguna ficha ni listado contiene carrito, cantidad, compra rápida ni botones de pago |  |
| ✔ | Datos correctos por categoría y los desconocidos se ocultan (garage, harbor, estate, mínimo) |  |
| ✔ | Ubicación pública: respeta la precisión elegida (región, ciudad, país) |  |
| ✔ | Pieza sin portada ni vídeo: composición de reserva, mensaje útil y contacto |  |
| ✔ | Pieza vendida: estado inequívoco, sin precio ni «Me interesa», con «Busco algo parecido» |  |
| ✔ | WhatsApp y email: referencia, nombre y URL correctas y bien codificadas |  |
| ✔ | Sin canales configurados no hay enlaces de WhatsApp ni email (perfil vacío) y se avisa en el editor |  |
| ✔ | Compartir: copiar enlace funciona cuando no hay Web Share |  |
| ✔ | Barra fija de contacto en móvil: visible, se oculta con el formulario a la vista y no tapa contenido |  |
| ✔ | Piezas relacionadas: de la misma división, explicables, nunca vendidas ni la propia |  |
| ✔ | Filtros: consultan todo el catálogo (no solo la página visible), con estado en URL, atrás/adelante y recarga |  |
| ✔ | Filtros: estado vacío invita a ampliar la búsqueda o contactar; mensaje de carga con aria-busy |  |
| ✔ | Orden: solo opciones reales (editorial, novedades); sin «más populares»; el precio solo si se activa |  |
| ✔ | «Cargar más»: añade piezas reales de la página siguiente y la paginación real sigue disponible sin JavaScript |  |
| ✔ | «Cargar más»: al volver desde una ficha se restauran las páginas cargadas |  |
| ✔ | Filtros en móvil: panel modal accesible, «Ver N piezas», devuelve el foco |  |
| ✔ | Filtros: sin JavaScript el formulario funciona (GET) y se muestra «Aplicar filtros» |  |
| ✔ | Buscador: diálogo accesible, sugerencias reales (API), resultados con filtros y estado vacío |  |
| ✔ | Favoritos: guardar en tarjeta y ficha, aria-pressed, contador, persisten tras recargar y sincronizan entre pestañas |  |
| ✔ | Favoritos: la página consulta el estado ACTUAL (vendida, retirada) y permite quitar y vaciar con confirmación |  |
| ✔ | Favoritos: contenido corrupto, versión futura y almacenamiento bloqueado se gestionan con aviso honesto |  |
| ✔ | Consulta: el formulario identifica la pieza, valida en cliente y el éxito sale de la respuesta real de Shopify |  |
| ✔ | Consulta: error devuelto por el servidor se muestra con los datos conservados (sin éxito falso) |  |
| ✔ | Consulta: fallo de red conserva los datos y permite reintentar; la pantalla anti-spam se gestiona con envío nativo |  |
| ✔ | Consulta sin JavaScript: el formulario nativo envía y Shopify devuelve el éxito |  |
| ✔ | Propietarios: tres pasos, campos condicionales, la categoría viaja en el envío y los campos de otras categorías no |  |
| ✔ | Propietarios: ?cat= preselecciona la categoría; sin JavaScript se ven los tres pasos y todas las opciones |  |
| ✔ | Cuéntanos qué buscas y Contacto envían por el formulario nativo y sin promesas de alertas |  |
| ✔ | Preferencia WhatsApp/teléfono exige teléfono |  |
| ✔ | Cabecera: «Vender con Sidonia» siempre visible; en móvil, cajón accesible con Escape y foco restaurado |  |
| ✔ | Teclado: enlace para saltar al contenido, foco visible y orden lógico |  |
| ✔ | Auditoría automática de accesibilidad (idioma, landmarks, ids únicos, etiquetas, nombres, alt, encabezados) | 9 páginas |
| ✔ | Reducir movimiento: animaciones y transiciones se anulan |  |
| ✔ | Contraste real renderizado: texto principal, secundario y botones ≥ 4,5:1 | 6.48:1 mínimo |
| ✔ | Analítica: eventos útiles, una sola vez, sin datos personales y solo con consentimiento |  |
| ✔ | Analítica: filtros aplicados solo envían nombres de filtro y recuento, no valores ni búsquedas |  |
| ✔ | Los componentes son idempotentes: quitar y volver a insertar secciones no duplica listeners ni vídeos |  |
| ✔ | Sección renderizada de forma independiente (Section Rendering API): cada sección devuelve su HTML | 10 secciones |
| ✔ | Home y ficha: sin terceros, imagen principal con prioridad, resto diferido, CLS bajo | / CLS 0.000 eager 1 · /collections/explorar CLS 0.000 eager 1 · /products/prueba-coche-a CLS 0.000 eager 1 |

## 4. Validador estático y contraste

Contraste calculado de la paleta por defecto (WCAG, fórmula de luminancia relativa). Los colores de división usados como **texto** se oscurecen automáticamente si no llegan a 4,5:1.

| Pareja | Ratio | Mínimo | Resultado |
|---|---|---|---|
| Texto sobre fondo | 14.42:1 | 4.5:1 | cumple |
| Texto sobre superficie | 15.45:1 | 4.5:1 | cumple |
| Texto secundario sobre fondo | 6.49:1 | 4.5:1 | cumple |
| Texto secundario sobre superficie alternativa | 5.77:1 | 4.5:1 | cumple |
| Texto del botón sobre botón | 15.45:1 | 4.5:1 | cumple |
| Texto claro sobre fondo oscuro | 14.05:1 | 4.5:1 | cumple |
| Anillo de foco sobre fondo | 7.51:1 | 3:1 | cumple |
| Borde de campo sobre superficie | 3.66:1 | 3:1 | cumple |
| Garage como texto sobre superficie alternativa | 5.77:1 | 4.5:1 | cumple |
| Harbor como texto sobre superficie alternativa | 6.69:1 | 4.5:1 | cumple |
| Estate como texto sobre superficie alternativa | 5.03:1 | 4.5:1 | cumple |
| Garage como texto sobre fondo | 6.48:1 | 4.5:1 | cumple |
| Harbor como texto sobre fondo | 7.51:1 | 4.5:1 | cumple |
| Estate como texto sobre fondo | 5.65:1 | 4.5:1 | cumple |
| Texto sobre Garage | 6.95:1 | 4.5:1 | cumple |
| Texto sobre Harbor | 8.05:1 | 4.5:1 | cumple |
| Texto sobre Estate | 6.05:1 | 4.5:1 | cumple |
| Error (#9c2018) sobre superficie | 7.52:1 | 4.5:1 | cumple |
| Éxito (#2d6a4a) sobre superficie | 6.05:1 | 4.5:1 | cumple |
| Reservado (#8a5a00) sobre superficie | 5.59:1 | 3:1 | cumple |

- Ajustes globales: 104
- Cadenas de interfaz: 357
- CSS total: 66.5 KB · JS total: 82.1 KB (sin comprimir)
- Archivos del tema: 119 · secciones: 35 · snippets: 40

Peso de los recursos propios (sin comprimir; el CDN de Shopify los sirve comprimidos):

| Recurso | Tamaño |
|---|---|
| sd-analytics.js | 4.2 KB |
| sd-base.css | 12.9 KB |
| sd-components.css | 26.6 KB |
| sd-core.js | 5.0 KB |
| sd-facets.js | 13.1 KB |
| sd-favorites.js | 16.0 KB |
| sd-forms.js | 15.4 KB |
| sd-header.js | 5.9 KB |
| sd-product.js | 4.6 KB |
| sd-sections.css | 27.0 KB |
| sd-video.js | 17.9 KB |

Avisos del validador (informativos): Clases usadas en Liquid sin regla en el CSS (55): sd-body (theme/layout/password.liquid), sd-community (theme/sections/c.

## 5. Hechos de Shopify por verificar (no se pudo consultar la documentación)

Son suposiciones razonables sobre las que se ha construido el tema. **Compruébalas al subirlo**; cada fila dice dónde se rompería algo si no se cumple.

| # | Suposición | Si no se cumple |
|---|---|---|
| 1 | El nombre de sección (`name`) admite hasta 25 caracteres y los ajustes usados son válidos (`page`, `video_url` con `accept`, `font_picker` con `assistant_n4`, `link_list` con `main-menu`/`footer`) | La subida del ZIP se rechaza con un mensaje que indica el archivo |
| 2 | `collection.filters` / `search.filters` devuelven los filtros configurados en Search & Discovery, incluidos filtros de metacampos de texto | No hay filtros: revisa la configuración de la app |
| 3 | Los metacampos de texto con opciones se pueden usar en colecciones inteligentes y filtros | Usar etiquetas en su lugar |
| 4 | La Section Rendering API (`?section_id=`) devuelve la sección con los filtros de la URL, y también con `page=` | Los filtros recargan la página completa (el tema ya hace esa alternativa) |
| 5 | `/products/<handle>?view=card` renderiza `templates/product.card.liquid` junto a una plantilla `product.json` | La página de Favoritos mostraría «Pieza retirada» en todas: sustituir por otra vía |
| 6 | Un metacampo `file_reference` de vídeo expone `sources` (formato, altura, url, mime) y `preview_image` en Liquid | No habría vídeo: usar medios del producto (ya hay alternativa) |
| 7 | `metafield_tag` / `metafield_text` funcionan sobre texto enriquecido y de varias líneas | La historia no se vería; usar el texto plano |
| 8 | La lista de referencias a metaobjetos (`timeline`) permite `entry.period.value` | La cronología quedaría vacía |
| 9 | `{% form 'contact' %}` en páginas de producto/página personalizada: tras éxito vuelve a la misma página con `posted_successfully?`; tras error, la renderiza con `form.errors` y los valores conservados | El JS detecta respuestas no esperadas y envía de forma nativa, pero hay que verlo |
| 10 | `contact[tags]` añade etiquetas al cliente | Quitar el campo oculto o gestionar etiquetas con Flow |
| 11 | `Shopify.customerPrivacy.analyticsProcessingAllowed()` está disponible tras `Shopify.loadFeatures(consent-tracking-api)` | La analítica (apagada por defecto) no enviaría nada: es el comportamiento seguro |
| 12 | `/search/suggest?section_id=predictive-search` con `resources[options][unavailable_products]=last` incluye productos sin stock | Sin sugerencias: quitar el parámetro |
| 13 | Los productos sin existencias siguen apareciendo en colecciones y búsqueda | Revisar Search & Discovery → Configuración |
| 14 | `image.presentation.focal_point` está disponible en imágenes de producto y de ajustes | El recorte usaría el centro |
| 15 | El precio de variante 0,00 y el inventario 0 impiden la compra y el producto sigue siendo visible | Revisar `05` |

## 6. Comprobaciones en Shopify antes de publicar (checklist)

- [ ] El ZIP se sube sin errores y aparece sin publicar.
- [ ] `shopify theme check --path theme`: cero errores.
- [ ] Una pieza de prueba rotulada [PRUEBA] por categoría: la ficha muestra sus datos y oculta los vacíos.
- [ ] `POST /cart/add.js` con la variante de una pieza devuelve error de agotado.
- [ ] Un formulario de cada tipo llega al correo de la tienda con pieza, referencia, categoría y URL; el cliente queda etiquetado.
- [ ] Filtrar por una marca que solo existe en la página 2 devuelve esas piezas; atrás/adelante y recarga conservan el estado.
- [ ] Favoritos: guardar, recargar, vender una pieza y comprobar «Vendido» en la página de favoritos.
- [ ] WhatsApp y email abren con el texto correcto en móvil real.
- [ ] Vídeo vertical en iPhone (Safari): reproduce, el sonido solo tras el toque, pantalla completa.
- [ ] Lector de pantalla (VoiceOver/NVDA): cabecera, tarjetas, filtros, modal de vídeo, formularios.
- [ ] Lighthouse móvil en home, colección y ficha: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1.
- [ ] Editor de temas: cargar, editar, mover y eliminar cada sección sin errores de consola.
