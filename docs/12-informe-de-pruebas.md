# 12 · Informe de pruebas

> Generado con `node tools/harness/tests/e2e.mjs && SIDONIA_TARGET=host node tools/harness/tests/e2e.mjs && node tools/harness/tests/report.mjs`.
> Léelo entero: explica con qué se ha probado y **qué no se ha podido probar**.

## 1. Resumen

| Comprobación | Resultado |
|---|---|
| Pruebas en navegador sobre **Impact 7.2.0 integrado** (copia de la tienda + kit + parches) | **49 de 49** correctas (2026-10-04 22:29 UTC) |
| Las mismas pruebas sobre el **anfitrión genérico** (sin Impact) | **47 de 47** correctas (2026-10-04 22:32 UTC) |
| `tools/check-kit.mjs` (anfitrión + kit) | sin errores |
| `tools/check-kit.mjs --theme impact/sidonia` (archivos del kit dentro de Impact) | sin errores |
| Contraste de la paleta (19 pares) | todos cumplen ([03](03-sistema-de-diseno.md)) |

## 2. Cómo se ha probado

| Capa | Herramienta | Qué demuestra | Límite |
|---|---|---|---|
| Liquid y esquemas | `tools/lint/liquid.mjs`, `tools/lint/schema.mjs` (propios) | Etiquetas y filtros de Shopify, sin filtros en parámetros de `render`/`if`/`for`, claves de traducción, ámbito de `render`, tipos y rangos de ajustes, nombres ≤ 25, plantillas JSON | No es Theme Check |
| Reglas del encargo | `tools/check-kit.mjs` | Nombres públicos, comunidades, sin subida de archivos, sin secretos, sin datos de formulario en el navegador, analítica sin datos personales, sin promesas prohibidas, límites de Search & Discovery, solo «es igual a», aislamiento CSS | — |
| Render | `tools/harness/liquid.mjs` (**intérprete propio**, no el de Shopify) con datos **[PRUEBA]** y los ajustes reales de `settings_data.json` de la tienda | Que Impact + kit producen el HTML esperado en 25 rutas | Puede diferir del motor de Shopify en detalles |
| Navegador | Chromium (Playwright) a 360, 390, 768, 1024 y 1440 px | Diseño, JavaScript de Impact y del kit, vídeo, filtros, favoritos, formularios, accesibilidad básica | Sin red externa; sin dispositivos reales |

## 3. Lo que NO se ha podido probar (pendiente en la tienda)

1. **Shopify Theme Check / Shopify CLI**: no se pudieron instalar (sin acceso a npm). Ejecuta `shopify theme check --path impact/sidonia`.
2. **Subida real del ZIP y editor de Shopify**: no hay acceso a la tienda. Se ha simulado la carga/descarga de secciones del editor.
3. **Recepción de formularios** en el correo de la tienda y la pantalla anti-spam real (el arnés simula éxito, errores, red y verificación).
4. **Bloqueo real de compra** de piezas (inventario y canales): ver la prueba manual de [10](10-precios-y-compra.md).
5. **Search & Discovery** real: el arnés reproduce su contrato de filtros (`collection.filters`, URLs `filter.p.m.sidonia.*`).
6. **Vídeos reales** (MP4/HLS de Shopify), **YouTube/Vimeo** (sin red) y **Core Web Vitals** en red móvil real.
7. **jamesedition.com** no se pudo abrir (red bloqueada): ver [01](01-patrones-jamesedition.md).
8. **Lectores de pantalla reales** (VoiceOver, NVDA): se han comprobado roles, nombres accesibles, foco y anuncios, no una sesión con lector.
9. `tools/setup/provision.mjs` (Admin API) no se ha ejecutado contra una tienda.

## 4. Linter sobre los archivos propios de Impact (informativo)

El linter de esquemas, aplicado a **todo** Impact, señala 5 casos en archivos de Impact que no son errores reales
(un bloque `@theme`, colores por defecto `rgba(0,0,0,0)`, un menú por defecto distinto de main-menu/footer) y el de Liquid
2 avisos de ámbito en `product-quick-buy.liquid` de Impact. No se han tocado: son código de Maestrooo y Shopify los acepta.

## 5. Resultados sobre Impact 7.2.0 integrado

**1. Responsive, desbordes, errores y estructura**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Sin desbordes, sin errores y un solo h1 a 360px (25 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 390px (25 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 768px (25 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 1024px (25 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 1440px (25 páginas) |  |
| ✔ | Instalación vacía (sin piezas, sin redes, sin imágenes): sin errores ni desbordes a 360 y 1440 px |  |
| ✔ | Ninguna tarjeta anida elementos interactivos (botón dentro de enlace o enlace dentro de botón) |  |

**2. Home, primer bloque y categorías**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | El primer bloque comunica Coches, Barcos y Casas con alma y deja explorar y vender | titular, categorías, Explorar y buscador visibles a 390 px |
| ✔ | Nombres públicos exactos y puntos de color (rojo Coches, azul Barcos, verde Casas) | rgb(182, 63, 56) · rgb(40, 99, 142) · rgb(52, 116, 85) |
| ✔ | Buscador del hero: la pestaña de categoría sin texto lleva a su colección; con texto, a la búsqueda |  |

**3. Cabecera transparente y sólida**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Transparente sobre el hero, sólida al bajar, sin cambiar de altura; los paneles abren sobre superficie piedra opaca | altura constante 84px |
| ✔ | Páginas sin imagen inicial: cabecera sólida desde el principio (colección, ficha, vender, favoritos) |  |
| ✔ | Primer render correcto sin JavaScript (cabecera transparente por CSS y legible) |  |
| ✔ | Cabecera: «Vender» visible en móvil sin salirse ni montarse sobre el logo (360 px) |  |

**4. Catálogo, precios y tarjetas**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Precios: publicado con formato español; «Precio a consultar»; «Precio no publicado»; vendida sin precio; nunca 0 € | 24 tarjetas revisadas |
| ✔ | Cada tarjeta muestra categoría con punto, ubicación pública y estado reservado/vendido |  |
| ✔ | Filtros: el estado vive en la URL, se aplica sin recargar y funciona con atrás/adelante | 32 piezas → 14 piezas (14 tarjetas) |
| ✔ | Filtros en móvil: diálogo modal accesible que se cierra con Escape y devuelve el foco |  |
| ✔ | Cargar más añade piezas sin perder las anteriores y mantiene la URL compartible | 24 → 32 |
| ✔ | Sin JavaScript: filtros como formulario normal y paginación con enlaces |  |
| ✔ | El archivo de vendidas solo muestra piezas vendidas | 2 vendidas |

**5. Ficha de pieza**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | La ficha muestra precio, descripción, datos de la categoría, propietario autorizado, ubicación pública y referencia |  |
| ✔ | Al abrir la ficha no se descarga ni se crea ningún vídeo (portada primero) |  |
| ✔ | Reproducir abre con sonido, vertical sin recortar, Escape cierra y el foco vuelve | proporción 0.563, con sonido |
| ✔ | Solo suena un vídeo a la vez (reproductor de la ficha y modal) |  |
| ✔ | YouTube: no se carga nada externo sin permiso explícito |  |
| ✔ | WhatsApp y correo: mensaje con nombre, referencia y URL de la pieza, bien codificado |  |
| ✔ | Barra de contacto móvil: aparece al pasar el resumen y se oculta sobre el formulario de consulta |  |

**6. Favoritos**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Guardar desde una tarjeta, contador en la cabecera y página de favoritos con la pieza |  |
| ✔ | Una pieza retirada se muestra como «ya no disponible» y se puede quitar |  |

**7. Formularios (venta y consulta)**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Vender: un solo formulario en 3 pasos; ?categoria=barcos preselecciona Barcos y solo envía sus campos | 20 campos enviados |
| ✔ | Vender: un ?categoria= no válido no preselecciona nada y no rompe el formulario |  |
| ✔ | Vender: los errores se anuncian junto al campo y el foco va al primero | Elige si es un coche, un barco o una casa. |
| ✔ | Vender: fallo de red → aviso claro y los datos se conservan |  |
| ✔ | Vender: si Shopify pide verificación (anti-spam), se pasa al envío nativo |  |
| ✔ | Vender sin JavaScript: errores del servidor junto a los campos y valores conservados |  |
| ✔ | Consulta de una pieza: el envío identifica la pieza (referencia, nombre, categoría y URL) |  |

**8. Comunidad, redes y testimonios**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Total de seguidores calculado de las cuentas: suma solo las incluidas, sin duplicados, vacío ≠ 0 |  |
| ✔ | Sin cuentas con cifra: no hay total inventado, solo «Sigue las historias de Sidonia» |  |
| ✔ | Solo se publican testimonios marcados como autorizados |  |

**9. Analítica, accesibilidad y SEO**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Analítica: eventos con parámetros permitidos y sin datos personales | sidonia_view_listing, sidonia_contact_whatsapp |
| ✔ | Sin consentimiento de analítica no se publica ningún evento |  |
| ✔ | Movimiento reducido: el hero no reproduce vídeo de fondo |  |
| ✔ | Foco visible y orden de tabulación: el primer Tab llega a la cabecera, nunca a una portada |  |
| ✔ | Datos estructurados: oferta solo con precio publicado y pieza disponible; nunca precio 0; sin el JSON-LD comprable de Impact |  |
| ✔ | Teléfono y correo privados del propietario nunca aparecen en la web |  |

**10. Comercio normal de la tienda y editor de temas**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Un producto normal (no pieza) conserva el precio y la compra de Impact; aparece con su precio en la búsqueda |  |
| ✔ | En la colección «all» de Impact, las piezas usan la tarjeta Sidonia y los productos normales la de Impact; ningún 0,00 € | 11 piezas con tarjeta Sidonia junto a la tarjeta normal de Impact |
| ✔ | Editor de temas: descargar y volver a cargar secciones no da errores ni duplica comportamientos | 11 secciones descargadas y recargadas |

## 6. Resultados sobre el anfitrión genérico

**1. Responsive, desbordes, errores y estructura**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Sin desbordes, sin errores y un solo h1 a 360px (23 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 390px (23 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 768px (23 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 1024px (23 páginas) |  |
| ✔ | Sin desbordes, sin errores y un solo h1 a 1440px (23 páginas) |  |
| ✔ | Instalación vacía (sin piezas, sin redes, sin imágenes): sin errores ni desbordes a 360 y 1440 px |  |
| ✔ | Ninguna tarjeta anida elementos interactivos (botón dentro de enlace o enlace dentro de botón) |  |

**2. Home, primer bloque y categorías**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | El primer bloque comunica Coches, Barcos y Casas con alma y deja explorar y vender | titular, categorías, Explorar y buscador visibles a 390 px |
| ✔ | Nombres públicos exactos y puntos de color (rojo Coches, azul Barcos, verde Casas) | rgb(182, 63, 56) · rgb(40, 99, 142) · rgb(52, 116, 85) |
| ✔ | Buscador del hero: la pestaña de categoría sin texto lleva a su colección; con texto, a la búsqueda |  |

**3. Cabecera transparente y sólida**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Transparente sobre el hero, sólida al bajar, sin cambiar de altura; los paneles abren sobre superficie piedra opaca | altura constante 73px |
| ✔ | Páginas sin imagen inicial: cabecera sólida desde el principio (colección, ficha, vender, favoritos) |  |
| ✔ | Primer render correcto sin JavaScript (cabecera transparente por CSS y legible) |  |
| ✔ | Cabecera: «Vender» visible en móvil sin salirse ni montarse sobre el logo (360 px) |  |

**4. Catálogo, precios y tarjetas**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Precios: publicado con formato español; «Precio a consultar»; «Precio no publicado»; vendida sin precio; nunca 0 € | 24 tarjetas revisadas |
| ✔ | Cada tarjeta muestra categoría con punto, ubicación pública y estado reservado/vendido |  |
| ✔ | Filtros: el estado vive en la URL, se aplica sin recargar y funciona con atrás/adelante | 32 piezas → 14 piezas (14 tarjetas) |
| ✔ | Filtros en móvil: diálogo modal accesible que se cierra con Escape y devuelve el foco |  |
| ✔ | Cargar más añade piezas sin perder las anteriores y mantiene la URL compartible | 24 → 32 |
| ✔ | Sin JavaScript: filtros como formulario normal y paginación con enlaces |  |
| ✔ | El archivo de vendidas solo muestra piezas vendidas | 2 vendidas |

**5. Ficha de pieza**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | La ficha muestra precio, descripción, datos de la categoría, propietario autorizado, ubicación pública y referencia |  |
| ✔ | Al abrir la ficha no se descarga ni se crea ningún vídeo (portada primero) |  |
| ✔ | Reproducir abre con sonido, vertical sin recortar, Escape cierra y el foco vuelve | proporción 0.562, con sonido |
| ✔ | Solo suena un vídeo a la vez (reproductor de la ficha y modal) |  |
| ✔ | YouTube: no se carga nada externo sin permiso explícito |  |
| ✔ | WhatsApp y correo: mensaje con nombre, referencia y URL de la pieza, bien codificado |  |
| ✔ | Barra de contacto móvil: aparece al pasar el resumen y se oculta sobre el formulario de consulta |  |

**6. Favoritos**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Guardar desde una tarjeta, contador en la cabecera y página de favoritos con la pieza |  |
| ✔ | Una pieza retirada se muestra como «ya no disponible» y se puede quitar |  |

**7. Formularios (venta y consulta)**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Vender: un solo formulario en 3 pasos; ?categoria=barcos preselecciona Barcos y solo envía sus campos | 20 campos enviados |
| ✔ | Vender: un ?categoria= no válido no preselecciona nada y no rompe el formulario |  |
| ✔ | Vender: los errores se anuncian junto al campo y el foco va al primero | Elige si es un coche, un barco o una casa. |
| ✔ | Vender: fallo de red → aviso claro y los datos se conservan |  |
| ✔ | Vender: si Shopify pide verificación (anti-spam), se pasa al envío nativo |  |
| ✔ | Vender sin JavaScript: errores del servidor junto a los campos y valores conservados |  |
| ✔ | Consulta de una pieza: el envío identifica la pieza (referencia, nombre, categoría y URL) |  |

**8. Comunidad, redes y testimonios**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Total de seguidores calculado de las cuentas: suma solo las incluidas, sin duplicados, vacío ≠ 0 |  |
| ✔ | Sin cuentas con cifra: no hay total inventado, solo «Sigue las historias de Sidonia» |  |
| ✔ | Solo se publican testimonios marcados como autorizados |  |

**9. Analítica, accesibilidad y SEO**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Analítica: eventos con parámetros permitidos y sin datos personales | sidonia_view_listing, sidonia_contact_whatsapp |
| ✔ | Sin consentimiento de analítica no se publica ningún evento |  |
| ✔ | Movimiento reducido: el hero no reproduce vídeo de fondo |  |
| ✔ | Foco visible y orden de tabulación: el primer Tab llega a la cabecera, nunca a una portada |  |
| ✔ | Datos estructurados: oferta solo con precio publicado y pieza disponible; nunca precio 0; sin el JSON-LD comprable de Impact |  |
| ✔ | Teléfono y correo privados del propietario nunca aparecen en la web |  |

**10. Comercio normal de la tienda y editor de temas**

| Resultado | Prueba | Detalle |
|---|---|---|
| ✔ | Editor de temas: descargar y volver a cargar secciones no da errores ni duplica comportamientos | 10 secciones descargadas y recargadas |

## 7. Errores reales encontrados y corregidos durante las pruebas

| Error | Causa | Corrección |
|---|---|---|
| La ficha no mostraba el reproductor | `<sidonia-player>` sin `display: block` (elemento personalizado = en línea) | Regla de bloque para los elementos del kit, respetando `hidden` |
| El héroe desbordaba en móvil | Un `fieldset` usa `min-inline-size: min-content` | `min-inline-size: 0` y columnas `minmax(0, 1fr)` |
| Los filtros y «Cargar más» no funcionaban | La sección de catálogo no cargaba `sidonia-catalog.js` | Script diferido en la sección |
| La barra de contacto móvil no aparecía tras un salto | `IntersectionObserver` no avisa si se salta por encima del resumen | Medición por fotograma al desplazarse |
| Un envío colgado dejaba «Enviando…» para siempre | `fetch` sin límite de tiempo | Corte a los 25 s con aviso de conexión |
| La tarjeta desbordaba 5 px en la cuadrícula de 2 columnas de Impact | Precio y estado sin poder partir línea | Columna `minmax(0,1fr)` y `flex-wrap` |
| Iconos sobre el logo a 360 px y menú en dos líneas | Logo centrado de Impact + 6 enlaces + «Vender» | Diseño «logo a la izquierda»; corazón al panel móvil; espaciado en < 400 px |
| «Propietario» con dos puntos sueltos | Etiqueta solo para lectores de pantalla | La regla de «:» ignora etiquetas ocultas |
| Nombres de sección de más de 25 caracteres | Límite de Shopify | Nombres acortados |
| Al pasar de paso en el formulario, el paso quedaba bajo la cabecera fija | El cálculo no contaba la cabecera | `scroll-margin-top` con la altura real de la cabecera de Impact |
| `apply-kit --update` sobrescribía plantillas editadas y duplicaba las secciones conservadas | Las plantillas se trataban como archivos del kit | En `--update` se conservan; reaplicar sobre un tema integrado no cambia nada |
| Un producto normal no mostraba su información en el arnés | El intérprete de pruebas no exponía `section` a los snippets (Shopify sí) | Corregido el intérprete (no el tema) |

## 8. Peso de los recursos del kit (sin comprimir)

| Archivo | Tamaño |
|---|---|
| `sidonia-base.css` | 33,2 KB |
| `sidonia-catalog.js` | 14,4 KB |
| `sidonia-core.js` | 31,9 KB |
| `sidonia-forms.js` | 17,4 KB |
| `sidonia-product.js` | 4,4 KB |
| `sidonia-sections.css` | 51,0 KB |
| `sidonia-video.js` | 19,7 KB |

Ningún framework ni biblioteca externa. Se cargan diferidos; `sidonia-catalog.js`, `sidonia-forms.js` y `sidonia-product.js` solo en las páginas que los usan.
