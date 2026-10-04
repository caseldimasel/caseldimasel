# 01 · Patrones de JamesEdition y acabado Apple

## Qué se ha podido revisar

**No se ha podido abrir jamesedition.com desde el entorno de desarrollo** (la red solo permite el repositorio; las
peticiones a JamesEdition, shopify.dev y Maestrooo se bloquean). No se presenta, por tanto, ninguna «revisión visual»
de la web actual. Los patrones de abajo son los rasgos conocidos y estables de la plataforma (home con buscador
protagonista, navegación por categorías, listados en cuadrícula de imagen grande con precio y ubicación, ficha con
galería y bloque de contacto fijo). **Antes de publicar, revísalos en un navegador** en escritorio y móvil y anota
diferencias en esta tabla.

No se usa nada de JamesEdition: ni nombre, logo, inventario, fotos, textos ni código. Se trasladan patrones de organización.

## Patrones trasladados

| Patrón | Cómo lo aplica Sidonia | Dónde |
|---|---|---|
| Cabecera limpia: logo a la izquierda, categorías en línea, acciones a la derecha | Diseño de cabecera de Impact «logo a la izquierda, navegación en línea»; puntos de categoría; Favoritos; botón «Vender con Sidonia» | `header-group.json` + parche 10 |
| Buscador como entrada de la plataforma | Buscador en el primer bloque con selector Todo/Coches/Barcos/Casas; sin texto lleva a la colección; con texto, a resultados reales | `sidonia-hero` |
| Entradas por categoría con imagen grande | «Tres mundos, una misma selección» con portadas editables y número de piezas real | `sidonia-divisions` |
| Cuadrícula de anuncios: imagen protagonista, precio arriba, nombre, datos esenciales, ubicación | Tarjeta `sidonia-card` en el mismo orden de lectura; Guardar y Reproducir como botones separados | `sidonia-card` |
| Filtros en «píldoras» con desplegable y recuento | Píldoras en escritorio (≥1024 px), diálogo modal «Ver resultados» en móvil; chips de filtros activos; estado en la URL | `sidonia-catalog` |
| Ficha: medio grande a un lado, resumen y contacto fijo al otro | Vídeo (9:16 o 16:9) a la izquierda; título, precio, datos clave, propietario, ubicación y contacto a la derecha, fijo al desplazarse; barra de contacto en móvil | `sidonia-listing` |
| Contacto por anuncio con referencia | WhatsApp, correo y formulario con nombre, referencia y URL de la pieza | `sidonia-contact-actions`, `sidonia-listing-inquiry` |
| Guardar anuncios | Corazón en tarjetas, ficha y cabecera; página de favoritos | `sidonia-save`, `sidonia-favorites` |
| Relacionados al final de la ficha | Selección manual o misma categoría; nunca vendidas | `sidonia-listing-related` |

## Lo que Sidonia hace distinto a propósito

- **El vídeo narrado es el contenido principal**, no una galería: la portada es una imagen; el vídeo se abre con sonido al pulsar.
- **Catálogo seleccionado y pequeño:** el diseño funciona con pocas piezas (sin vacíos raros, estados vacíos útiles).
- **Sin posicionamiento de lujo exclusivo:** importa el carácter de la pieza; no hay sellos de «premium» ni urgencia artificial.
- **Tres categorías**, no decenas; el código admite añadir otra sin rehacer la navegación ([05](05-guia-de-edicion.md) §8).

## Acabado «Apple» (cómo se ha concretado)

- Una sola familia tipográfica heredada de Impact (Lato para textos, Carlito para títulos en la tienda actual); escala de títulos
  ajustable. Recomendación: probar una sans serif más neutra para títulos en *Ajustes del tema > Tipografía*.
- Rejilla y márgenes fluidos con `clamp()`; alineaciones en una cuadrícula de 4 px.
- Transiciones de 150–220 ms con curva suave; desaparecen con «reducir movimiento».
- Botones evidentes (oscuro sobre piedra, claro sobre imagen), foco visible siempre, sin cursores personalizados ni animaciones de carga.
- Desplazamiento natural del navegador: nada de scroll secuestrado.
