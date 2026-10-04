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

Los colores de división (rojo, azul, verde) son una hipótesis de diseño editable. Cuando se usan **como texto o icono** sobre fondos claros, el tema comprueba el contraste y **oscurece el color automáticamente** hasta llegar a 4,5:1. Cuando se usan **como relleno**, el texto encima se elige solo (claro u oscuro, el que contraste más). Aun así, revisa visualmente cada cambio.

Paleta inicial (editable): marfil `#F5F0E6`, superficie `#FBF8F2`, tinta `#231F1A`, garage `#A3261C`, harbor `#1D4F7C`, estate `#2D6A4A`. Los contrastes calculados están en `09-informe-de-pruebas.md`.

## Tipografía

Máximo dos familias: una para títulos y otra para interfaz y datos.

- **Por defecto**: pila de sistema, sin descarga ni licencias. Títulos: serif editorial (`Iowan Old Style`, `Palatino`, `Georgia`…); interfaz: sans del sistema.
- **Opcional**: «Biblioteca de Shopify». Elige cualquier fuente del selector; Shopify gestiona su licencia y su alojamiento. El tema precarga la fuente de interfaz y no bloquea el renderizado (`font-display: swap`).
- No se incluyen archivos de fuente en el tema.

## Home: secciones

Cada sección se puede añadir, quitar, reordenar y configurar. Orden de partida: Hero con vídeo → Tres mundos → Selección → Cómo vendemos → Una historia concreta → Confianza y comunidad → Criterio → Testimonios → Llamada a propietarios → Preguntas frecuentes.

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
