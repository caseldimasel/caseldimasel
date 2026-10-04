# 02 · Instalación y previsualización SIN publicar

El tema se entrega en `dist/sidonia-theme-1.1.0.zip` (carpetas del tema en la raíz del ZIP, sin documentación ni herramientas). **Subir el ZIP no lo publica.**

## Opción A · Subir el ZIP (recomendada)

1. Administrador de Shopify → **Tienda online → Temas**.
2. **Añadir tema → Subir archivo ZIP** → elige `sidonia-theme-1.1.0.zip`.
3. El tema aparece en «Biblioteca de temas», **sin publicar**. El tema actual (Impact) sigue activo.
4. Pulsa **Personalizar** en el tema nuevo para editarlo y **Acciones → Previsualizar** para ver una URL de previsualización. Si la tienda tiene contraseña, funciona igual.

**No pulses «Publicar» hasta haber revisado todo.** Esta entrega no autoriza publicar en producción.

## Opción B · Shopify CLI

```
shopify theme push --path theme --unpublished --theme "Sidonia"
shopify theme check --path theme
shopify theme dev --path theme --store TU-TIENDA   # previsualización con recarga
```

`--unpublished` crea un tema nuevo sin publicar. Revisa los avisos de Theme Check (ver `09-informe-de-pruebas.md`: aún no se ha podido ejecutar).

## Orden recomendado de puesta en marcha

1. Crear las **definiciones de metacampos y el metaobjeto** (`03-modelo-de-datos.md`).
2. Crear **colecciones** y **filtros** (`04-colecciones-y-filtros.md`).
3. Crear **páginas** con su plantilla (tabla siguiente) y los **menús** `main-menu` y `footer`.
4. Rellenar *Ajustes del tema* (logos, contacto, redes, divisiones).
5. Cargar una **pieza de prueba rotulada [PRUEBA]** de cada categoría y repasar `09-informe-de-pruebas.md` → «Comprobaciones en Shopify».
6. Borrar las piezas de prueba y cargar las reales.

## Páginas, plantillas y handles

El tema usa las rutas nativas de Shopify. **Una página no puede estar en una URL arbitraria**: siempre es `/pages/<handle>`, `/collections/<handle>` o `/products/<handle>`.

| Página | Tipo / plantilla a asignar | Handle de reserva | Alternativa |
|---|---|---|---|
| Inicio | `index` | — | — |
| Explorar | Colección, plantilla `collection` | `explorar` | `/collections/all` si no hay colección |
| Garage | Colección, plantilla `collection.garage` | `garage` | — |
| Harbor | Colección, plantilla `collection.harbor` | `harbor` | — |
| Estate | Colección, plantilla `collection.estate` | `estate` | — |
| Archivo de vendidas | Colección, plantilla `collection.archive` | `archivo` | — |
| Ficha de coche / barco / casa | Producto, plantilla `product.garage` / `product.harbor` / `product.estate` (o `product`) | — | El módulo técnico se elige por `sidonia.category`, aunque la plantilla sea otra |
| Vender con Sidonia | Página, plantilla `page.sell` | `vender` | — |
| Cómo vendemos | Página, plantilla `page.how-it-works` | `como-vendemos` | — |
| Sobre Sidonia | Página, plantilla `page.about` | `sobre-sidonia` | — |
| Favoritos | Página, plantilla `page.favorites` | `favoritos` | — |
| Contacto | Página, plantilla `page.contact` | `contacto` | — |
| Cuéntanos qué buscas | Página, plantilla `page.wanted` | `busco` | — |
| Marcas de coches y barcos | Página, plantilla `page.brands` | `marcas` | Ajustes del tema → Páginas clave → «Marcas». Muestra **todas** las marcas (lista en `tools/brands.json`); los números salen de los filtros reales de la colección |
| Aviso de privacidad y legales | Página, plantilla `page.legal` (o política de Shopify) | `privacidad` | Políticas de Shopify |
| Buscar / 404 / carrito | `search` / `404` / `cart` | — | — |
| Historias (opcional) | Blog de Shopify, plantillas `blog` y `article` | — | — |

Si ya existen páginas con otros handles, **no los cambies**: elígelas en *Ajustes del tema → Páginas clave* y en los menús. Para URLs antiguas que hayan cambiado, crea **redirecciones** en *Contenido → Navegación → Redirecciones de URL* (de la ruta antigua a la nueva). Shopify añade una redirección automática al cambiar el handle si marcas la casilla correspondiente.

## Qué NO hace el tema por sí solo

- No crea metacampos, colecciones, páginas, menús ni filtros.
- No configura el correo de recepción de formularios.
- No modifica la tienda actual ni el tema Impact.
