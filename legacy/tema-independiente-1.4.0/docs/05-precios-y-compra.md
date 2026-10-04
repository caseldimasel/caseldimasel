# 05 · Precios altos, «precio a consultar» y anuncios no comprables

## 1. Principio: precio editorial ≠ precio de la variante

Una pieza única (casa, barco, coche) no es un producto con cantidad. Por eso el tema **nunca imprime `product.price`** ni el precio de ninguna variante. El precio que ve el visitante sale de metacampos:

| Metacampo | Efecto |
|---|---|
| `sidonia.price_mode` = `Publicado` + `sidonia.price_amount` > 0 | Se muestra el importe (con separador de miles y símbolo de moneda; no hay conversión de divisas) |
| `sidonia.price_mode` = `A consultar` | «Precio a consultar» (texto editable en Ajustes del tema) |
| `sidonia.price_mode` = `No publicado` o vacío | «Precio no publicado» |
| `Publicado` pero importe vacío o 0 | Se trata como «no publicado» (nunca se enseña un 0) |

Consecuencias:

- **Interfaz, buscador y tarjetas:** nunca muestran un 0 técnico.
- **Datos estructurados:** solo se emite una oferta (`Offer`) si el modo es `Publicado`, el importe es mayor que 0 **y** el estado es `Disponible`. Reservadas, vendidas, «a consultar» y «no publicado» no llevan oferta. No hay valoraciones ni reseñas inventadas.
- **Búsqueda:** el texto de precio no se busca. Se busca por título, descripción, etiquetas, proveedor y tipo.

## 2. Límites de precio de Shopify

No se pudo consultar la documentación vigente desde el entorno de desarrollo. **Comprueba antes de cargar piezas reales** el importe máximo que admite el precio de una variante en vuestro plan y canal, porque una casa o un yate pueden superarlo.

El diseño evita el problema: el precio público vive en `sidonia.price_amount` (decimal), que no depende del límite del precio de variante. La variante solo existe para que el producto exista.

## 3. Filtros y orden por precio

- Un metacampo de precio **no** se convierte en el filtro nativo de precio. El filtro nativo de Shopify consulta el precio de la **variante**.
- Por eso el tema ofrece **bandas de presupuesto** (`sidonia.price_band`, texto) como filtro real. Se calculan con `tools/compute-bands.mjs` a partir del precio público. Piezas «a consultar» o «no publicado» **no tienen banda** (no aparecen en ninguna banda de precio).
- **Orden por precio** (menor a mayor y al revés) y **filtro nativo de precio** están **desactivados por defecto**. Actívalos en *Ajustes del tema → Catálogo y funciones* solo si el precio de la variante de **todas** las piezas es su precio público real. Si no, el orden mezclaría piezas sin precio y sería engañoso. El orden lo hace Shopify sobre todo el catálogo, no sobre las tarjetas cargadas.
- Orden ofrecido siempre: «Selección editorial» (orden manual de la colección) y «Novedades». No hay «Más populares».

## 4. Configuración para que no se pueda comprar

Ocultar el carrito en la interfaz **no basta**: los endpoints de Shopify (`/cart/add`, enlaces permanentes de carrito, checkout) siguen existiendo. Configuración base recomendada para cada pieza:

1. Producto **publicado en Online Store** (necesario para que la ficha exista) y **en ningún otro canal de venta** sin autorización expresa.
2. Una sola variante, con **seguimiento de inventario activado** y **cantidad 0**.
3. **«Seguir vendiendo cuando no haya existencias» desactivado.**
4. Sin requerir envío si no procede.

Con esto, `product.available` es falso: Shopify rechaza añadirlo al carrito. El tema **no usa** `product.available` para el estado: «Disponible/Reservado/Vendido» es el metacampo `sidonia.status`.

Verificación (en un entorno autorizado, con una pieza de prueba): 

```
curl -s -X POST https://TU-TIENDA/cart/add.js -H 'Content-Type: application/json' -d '{"id": ID_VARIANTE, "quantity": 1}'
```

Debe devolver un error de producto agotado, no un artículo en el carrito. Prueba también `https://TU-TIENDA/cart/ID_VARIANTE:1`. **Esta prueba no se ha podido realizar** (no hay acceso a una tienda): consta como pendiente en `09-informe-de-pruebas.md`.

Refuerzo opcional (requiere app o código de servidor, no incluido): una validación de carrito (Shopify Function) que bloquee cualquier línea cuyo producto tenga `sidonia.category`.

## 5. Si conviven anuncios y comercio normal

Si en la misma tienda vendes libros, arte u otros productos sí comprables:

- **No cambies ajustes globales** (inventario, canales, «seguir vendiendo» por defecto).
- Distingue las piezas por el metacampo `sidonia.category` y por las colecciones de Sidonia (`explorar`, `coches`, `barcos`, `casas`, `archivo`).
- Este tema **no tiene interfaz de compra**: los productos normales no se podrían comprar con él. Para convivir hay que usar este tema en una tienda dedicada, o añadir una plantilla `product.<otra>` con compra normal asignada solo a esos productos (trabajo no incluido).

## 6. Disponible no es «comprable»

«Disponible» significa que la pieza **acepta consultas**. Ninguna parte del tema presenta una pieza disponible como si se pudiera comprar, reservar con pago, financiar o subastar. No existen depósitos, reservas de pago, comisiones, garantías ni pagos a vendedores.
