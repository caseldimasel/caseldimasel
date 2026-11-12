# 05 · Guía de edición (para el equipo de Sidonia)

Todo se edita en **Tienda online > Temas > (duplicado Sidonia) > Personalizar**, salvo los datos de cada pieza, que se
editan en **Productos** ([16](16-fichas-paso-a-paso.md)). Nada de esta guía exige tocar código.

## 1. Textos de la portada y de las páginas

Cada bloque de la portada es una sección **«Sidonia · …»** que se puede añadir, quitar, ordenar y ocultar:

| Sección | Qué editas |
|---|---|
| Sidonia · Hero y búsqueda | Titular, subtítulo, botones, imagen o vídeo de fondo (con versión móvil), oscurecido, vídeo «Ver cómo lo contamos», buscador, cabecera transparente |
| Sidonia · Tres mundos | Título y textos; las portadas y frases de cada categoría vienen de *Ajustes del tema > Sidonia · Categorías* |
| Sidonia · Selección | Colección o lista de piezas (4–8), mostrar o no vendidas |
| Sidonia · Cómo vendemos | Los cuatro pasos (bloques) |
| Sidonia · Una historia | La pieza que se cuenta (si no hay pieza elegida, el bloque no se ve fuera del editor) |
| Sidonia · Comunidad | Dato de clientes («Más de 200 clientes han confiado en nosotros para vender sus propiedades»), frase de la comunidad; las redes vienen del metaobjeto |
| Sidonia · Criterio | Qué buscamos (bloques) |
| Sidonia · Testimonios | Testimonios **reales**; solo se publican los que tienen marcada «Autorizado para publicar» |
| Sidonia · Propietarios | «¿Tienes algo que merece ser contado?» y su botón (con preselección opcional de categoría) |
| Sidonia · Preguntas | Preguntas y respuestas (generales o de una categoría) |

Las secciones de la portada anterior de la tienda están al final, **desactivadas** (prefijo `impact_`): se pueden activar o borrar.

## 2. Logos

- **Logo principal y logo blanco para la cabecera transparente:** *Personalizar > Cabecera* (ajustes propios de Impact:
  «Logo» y «Cabecera transparente > Logo»). La tienda ya tiene los PNG negro y blanco de SIDONIA.
- **Isotipo** (para portadas sin imagen): *Ajustes del tema > Sidonia · Marca y tipografía*.
- **Favicon:** *Ajustes del tema > Logo y favicon* (Impact).
- **SVG:** los selectores de imagen de Shopify aceptan PNG, JPG, WebP y GIF; **no** cuentes con subir SVG ahí. Vía segura para
  un SVG: súbelo a *Contenido > Archivos* (Shopify lo convierte o lo sirve como archivo) y úsalo como imagen si el
  selector lo admite; si no, exporta un PNG a 2× del ancho de logo (por ejemplo 310 px para un logo de 155 px).
- Ancho del logo en móvil: con «Vender» y el carrito en la barra, **120–140 px** es lo que cabe sin apretar a 360 px.

## 3. Colores y tipografía

*Ajustes del tema > Sidonia · Colores* (paleta piedra y botón) y *Sidonia · Categorías* (color de cada punto).
*Sidonia · Integración con Impact > Aplicar la paleta piedra* lleva esos colores al resto del tema. Contrastes en [03](03-sistema-de-diseno.md):
si cambias un color, comprueba que el texto sigue en 4,5:1 (`node tools/contrast.mjs '#texto' '#fondo'`).

## 4. Vídeos

Por pieza: metacampos de vídeo ([08](08-video.md)). En la portada: *Sidonia · Hero y búsqueda > Vídeo «Ver cómo lo contamos»*
(archivo de Shopify o URL de YouTube/Vimeo) y clip de fondo silencioso opcional.

## 5. Métricas, comunidad y redes

- *Contenido > Metaobjetos > Cuenta social de Sidonia*: una entrada por cuenta (red, nombre, URL, seguidores, «Incluir en el total», fecha).
- El total se calcula solo; **no hay un total que escribir**. Cifra vacía = no se suma (no es 0). Sin cifras: «Sigue las historias de Sidonia».
- La misma fuente alimenta la portada, el pie y «Sobre Sidonia».

## 6. Menús

*Tienda online > Navegación*: menú `sidonia-principal` (Explorar, Coches, Barcos, Casas, Cómo vendemos, Sobre Sidonia) y,
en *Personalizar > Cabecera*, elegirlo como menú principal y de cajón. El punto de color aparece solo en los enlaces que
apuntan a la colección de una categoría. «Vender con Sidonia» y Favoritos no van en el menú: los pone el tema.

## 7. Contactos

*Ajustes del tema > Sidonia · Contacto*: correo y WhatsApp generales (formato internacional, p. ej. `+34 600 000 000`),
correos y WhatsApp por categoría (opcionales), horario y mensajes predefinidos (`[nombre]`, `[referencia]`, `[url]`).
Si un canal está vacío, su botón **no aparece** (nunca se genera un enlace a un número de ejemplo).
El destinatario de los **formularios** no se elige aquí: es el correo de *Ajustes > Notificaciones* de Shopify ([07](07-formularios-y-leads.md)).

## 8. Añadir una cuarta categoría (sin rehacer la navegación)

1. En `kit/snippets/sidonia-division-keys.liquid`, añade la clave (p. ej. `garage,harbor,estate,atelier`).
2. Añade sus ajustes (`sidonia_atelier_name`, `_community`, `_color`, `_collection`, `_tagline`, `_image`, `_email`,
   `_whatsapp`) al grupo «Sidonia · Categorías» de `kit/config/settings_schema.sidonia.json`.
3. Si tiene datos técnicos propios, añádelos a `data/metafields.json` (grupo nuevo), a `sidonia-specs` y a `sidonia-sell-fields`.
4. Crea `collection.atelier.json` y `product.atelier.json` en `tools/build-templates.mjs` y regenera.
5. `node tools/check-kit.mjs` y vuelve a integrar con `apply-kit --update`.

El punto de color, el selector del buscador, los filtros de categoría y el formulario de venta se generan a partir de la lista de claves.
