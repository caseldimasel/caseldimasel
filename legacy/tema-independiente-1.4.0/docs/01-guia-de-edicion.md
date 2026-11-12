# 01 · Guía de edición (para el equipo de Sidonia)

Todo se edita desde **Tienda online → Temas → Personalizar** del tema Sidonia (sin publicar). No hace falta tocar código salvo para añadir una división nueva.

## Dónde está cada cosa

| Quiero cambiar… | Dónde |
|---|---|
| Logo, isotipo, favicon, ancho del logo, nombre de marca | *Ajustes del tema → Marca y logos* |
| Colores generales y de cada división | *Ajustes del tema → Colores* |
| Tipografías y tamaño de títulos | *Ajustes del tema → Tipografía* |
| Ancho del contenido, radios, proporción de portadas, columnas en móvil | *Ajustes del tema → Diseño* |
| Nombre, frase, portada, colección, email y WhatsApp de cada división | *Ajustes del tema → Divisiones* |
| Páginas que enlazan los botones (Vender, Cómo vendemos, Favoritos…) | *Ajustes del tema → Páginas clave* |
| Email, WhatsApp, teléfono, horario, mensajes de WhatsApp y email | *Ajustes del tema → Contacto y mensajes* |
| Perfiles y cifras de redes | *Ajustes del tema → Redes y comunidad* |
| Previsualizaciones de vídeo, confirmación de YouTube/Vimeo, calidad | *Ajustes del tema → Vídeo* |
| Textos de botones y de «Precio a consultar» | *Ajustes del tema → Textos de botones* |
| «Cargar más», piezas por página, orden por precio, compartir | *Ajustes del tema → Catálogo y funciones* |
| Enlaces legales del pie, aviso de privacidad, copyright | *Ajustes del tema → Legal y privacidad* |
| Analítica opcional | *Ajustes del tema → Analítica* |
| Menú principal y menú del pie | *Contenido → Navegación* (menús `main-menu` y `footer`) y selector de menú de la cabecera y del pie |
| Secciones de la home y de cada página | Personalizar → elige la plantilla → añade, quita, reordena y edita secciones |

## Logos e isotipo (incluido SVG)

1. Sube los archivos a **Contenido → Archivos** (o directamente desde el selector de imagen).
2. En *Marca y logos* elige:
   - **Logo versión oscura**: para fondos claros (cabecera).
   - **Logo versión clara**: para fondos oscuros (pie, reproductor).
   - **Logo principal**: se usa si falta alguna de las dos versiones.
   - **Isotipo**: se usa en móvil estrecho (menos de 480 px) cuando la cabecera va justa.
3. SVG: Shopify lo sirve como imagen. El tema lo carga **siempre con `<img>`**, nunca lo incrusta en la página, así que un SVG no puede ejecutar scripts. Sube SVG con `viewBox` y sin dimensiones fijas absurdas.
4. Sin logo subido, el tema usa el **logotipo de Sidonia incluido** (`theme/assets/sidonia-logo-light.png` para fondos oscuros y `sidonia-logo-dark.png` para claros), mientras *Usar el logotipo incluido* esté activo. Si lo desactivas, la cabecera muestra la palabra del *Nombre de la marca* en texto.
5. Para cambiar el logotipo de forma permanente basta con subir el tuyo en *Marca y logos*; el incluido deja de usarse.

## Marcas y fotos

- **Marcas**: la página `marcas` y la sección «Marcas» del inicio (editable en el personalizador) listan todas las marcas de coches y barcos. La lista está en `tools/brands.json`; tras editarla, `node tools/generate-brands.mjs`. Ver `04`.
- **Fotos del inicio**: el mosaico del encabezado usa, por división, la *Portada* de *Ajustes del tema → Divisiones*; si no hay, la imagen de la colección; si no hay, la portada de su primera pieza. Para fijar una imagen propia, sube una *Portada del hero* en la sección Hero.
- **Fotos de las piezas**: la primera imagen de cada producto es la portada de la tarjeta; sube fotos horizontales de buena calidad (el tema recorta a la proporción elegida en *Tarjetas*).

## Colores y contraste

Los colores de división (rojo, azul, verde) vienen de los archivos de marca de Sidonia y son editables. Cuando se usan **como texto o icono** sobre fondos claros, el tema comprueba el contraste y **oscurece el color automáticamente** hasta llegar a 4,5:1. Cuando se usan **como relleno**, el texto encima se elige solo (claro u oscuro, el que contraste más). Aun así, revisa visualmente cada cambio.

Paleta inicial (editable, tomada de los archivos de marca): papel `#F5F2EB`, tinta `#111111`, coches `#B2000B`, barcos `#165CA3`, casas `#016D5A` (la marca Time, `#FFA900`, queda disponible si se añade como división). Los contrastes calculados están en `09-informe-de-pruebas.md`.

## Tipografía

Por defecto el tema usa las **tipografías de la marca** que aportó Sidonia: **KMR Apparat Medium** (títulos, precios, botones y negritas) y **Switzer Light** (texto corrido). Los archivos están en `theme/assets/kmr-apparat-medium.otf` y `theme/assets/switzer-light.otf` y se cargan con `@font-face` desde el propio tema (sin servicios externos).

- Switzer solo existe en peso Light y KMR Apparat solo en Medium: el tema asigna Switzer a los pesos normales y KMR a los pesos ≥ 600, de modo que lo que va en negrita se ve en KMR Medium (sin negrita sintética).
- En *Ajustes del tema → Tipografía* puedes cambiar a fuentes del sistema o a la biblioteca de Shopify.
- **Licencia:** comprueba que la licencia de ambas fuentes permite su uso web (`@font-face`) antes de publicar. Si no, desmarca la opción de marca y usa otra.

## Home: secciones

Cada sección se puede añadir, quitar, reordenar y configurar. Orden de partida: Puesta en marcha (solo editor) → Hero con buscador → Tipos (Coches/Barcos/Casas) → Tres carruseles de piezas destacadas → Búsquedas populares → Galería de fotos → Marcas → Franja de valores → Cómo vendemos → Una historia concreta → Diario → Confianza y comunidad → Criterio → Testimonios → Llamada a propietarios → Formulario de vender → Preguntas frecuentes.

- **Carrusel de piezas** (uno por tipo): toma la colección del tipo (Ajustes del tema → Divisiones) o la que elijas; no muestra las vendidas y se oculta si no hay piezas. Flechas y deslizamiento táctil.
- **Búsquedas populares**: atajos editables (texto + enlace). Comprueba que cada enlace lleva a resultados reales.
- **Galería de fotos**: hasta 9 fotos con descripción (accesibilidad) y firma de Sidonia opcional; sin foto propia usa las incluidas.
- **Franja de valores**: tres razones para confiar; sin cifras ni promesas que no puedas cumplir.
- **Diario**: últimas historias de un blog de Shopify (se oculta si no hay blog o artículos).
- **Boletín** (opcional, **no está en la portada por defecto**): añádelo desde «Añadir sección». Crea clientes con la etiqueta `newsletter` y pide consentimiento explícito. Para enviar correos hace falta Shopify Email u otra herramienta; no lo actives sin esa conexión real.
- **Megamenú**: aparece solo al pasar el ratón o enfocar con teclado Coches, Barcos o Casas en el menú principal (los enlaces del menú deben apuntar a las colecciones de cada tipo). Muestra marcas populares y épocas con filtros reales.
- **Hero**: titular, subtítulo, dos botones, buscador y accesos a divisiones. Vídeo protagonista: *vídeo subido a Shopify*, *enlace de YouTube/Vimeo* o *una pieza elegida*. Sin vídeo no aparece el botón «Ver cómo lo contamos» y se muestra la portada o una composición con los colores de las divisiones.
- **Selección de piezas**: 4–8 piezas desde una colección (recomendado: una colección inteligente «Destacadas» con `sidonia.featured` = verdadero) o a mano. Oculta las vendidas por defecto. Sin piezas, la sección se oculta en la tienda y solo se ve un aviso en el editor.
- **Una historia concreta**: elige una pieza **real** con vídeo. Sin pieza, se oculta fuera del editor.
- **Confianza y comunidad**: el dato del fundador («Más de 200 clientes han confiado en nosotros para vender sus propiedades») significa clientes que han confiado; no lo cambies a «ventas». Los seguidores salen de *Redes y comunidad*: **un campo vacío no se publica**; nunca se suman cuentas.
- **Testimonios**: solo bloques con la casilla «autorización escrita» marcada. Sin testimonios válidos, la sección se oculta.
- **Preguntas frecuentes**: tarifas, exclusividad y plazos no están inventados. Añade esa pregunta solo cuando tengáis la respuesta real.

## Contactos

*Ajustes del tema → Contacto y mensajes*. Un canal vacío **desaparece** de la web (nunca se genera un enlace con datos de ejemplo). Formato del WhatsApp: signo `+`, prefijo del país y número, sin espacios. Cada división puede tener su propio email y WhatsApp. Variables de los mensajes: `[nombre]`, `[referencia]`, `[url]`.

El enlace de **email** abre el cliente de correo del visitante: **no** equivale a un mensaje enviado desde la web. El formulario sí envía desde la web (ver `08-formularios-y-leads.md`).

## Añadir una división nueva (por ejemplo, «Air»)

La navegación principal, el hero, «Tres mundos», pie, 404, favoritos y buscador recorren la lista de divisiones, así que no se reescriben. Para activar una nueva:

1. `theme/config/settings_schema.json`: copia el grupo de ajustes de una división (nombre, frase, colección, imagen, email, WhatsApp) con prefijo `division_air_*`, y añade `color_air` en *Colores*.
2. `theme/snippets/division-keys.liquid`: añade `air` a la lista.
3. `theme/snippets/css-variables.liquid`: añade las variables `--sd-air`, `--sd-air-text`, `--sd-air-on` (copia las de garage).
4. `theme/assets/sd-base.css`: añade el bloque `.sd-cat--air, [data-cat='air'] { … }` (copia el de garage).
5. Si tendrá ficha propia: añade su módulo en `snippets/listing-facts.liquid`, `listing-specs.liquid`, `product-specs.liquid` (lista de grupos) y un campo en el formulario de propietarios (`sections/sell-form.liquid`).
6. Crea la colección y el valor `Air` en `sidonia.category`.

## Qué NO hacer

- No subas documentos personales a *Documentos* de una pieza: los archivos son públicos.
- No rellenes «Precisión: Ciudad» si el propietario no ha autorizado la ciudad.
- No marques una pieza como Disponible si no admite consultas.
