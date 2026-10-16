# 10 · Precios, «a consultar» y piezas no comprables

## 1. Precio editorial ≠ precio de Shopify

El precio que ve el visitante sale de los metacampos de la pieza, **nunca del precio de la variante**:

| `price_mode` | `price_amount` | Estado | Se muestra |
|---|---|---|---|
| Publicado | 85000 | Disponible / Reservado | **85.000 €** (formato español; 4 cifras sin separador: «8500 €») |
| A consultar | (cualquiera) | — | **Precio a consultar** |
| No publicado o vacío | — | — | **Precio no publicado** |
| (cualquiera) | — | Vendido | **Vendida** (sin importe) |

Esto vale en tarjetas, ficha, barra móvil, búsqueda predictiva de Impact (parche `price-guard`), relacionados y cualquier
componente de Impact que pinte precios de una pieza. **Nunca aparece 0 € ni «gratis»** (probado).

Los **productos normales** de la tienda (sin `sidonia.category`) siguen mostrando su precio de Shopify y se compran como siempre.

## 2. Límite de precio de Shopify

No se ha podido verificar en la documentación vigente el importe máximo que admite el precio de una variante.
**Compruébalo en el administrador** con el importe más alto previsto (una casa o un yate): si Shopify lo rechaza, no
pasa nada en la web, porque el precio editorial es un metacampo `number_decimal` independiente.

## 3. Consecuencias de separar los precios

| Función | Fuente | Nota |
|---|---|---|
| Precio visible | `sidonia.price_amount` | — |
| Filtro «Presupuesto» | `sidonia.price_band` (texto) | Banda que pone el equipo; vacía si es a consultar |
| Ordenar por precio | Precio de la variante | **Desactivado por defecto**. Actívalo (*Sidonia · Catálogo > Las variantes reflejan el precio publicado*) solo si la variante de cada pieza publicada tiene su precio real y las «a consultar» tienen un valor coherente |
| Datos estructurados | `sidonia.price_amount` | Oferta solo si precio «Publicado» > 0, estado Disponible y *Sidonia · Catálogo > Publicar el precio como oferta en datos estructurados* activado (lo está por defecto). Nunca para «a consultar», no publicado o vendida. El JSON-LD comprable de Impact y `og:price` se omiten en las piezas (parche `seo-guard`) |

## 4. Que nadie pueda comprar una pieza

La interfaz ya no ofrece compra en las piezas (plantillas Sidonia sin bloque de compra, tarjeta sin compra rápida, parche
`buy-guard` por si una pieza aparece en una sección de producto de Impact). **Eso no basta**: la tienda podría aceptar un
`/cart/add` directo. Configuración obligatoria **por pieza**:

1. Una sola variante, **inventario controlado por Shopify con cantidad 0**.
2. **Desactivado** «Seguir vendiendo cuando no haya existencias».
3. Canales de venta: solo **Tienda online** (para que se vea); ningún canal de compra adicional (Shop, redes, POS…).
4. *Search & Discovery > Ajustes* (o *Preferencias de búsqueda*): que los productos **agotados se sigan mostrando** en
   colecciones y búsqueda; la disponibilidad que importa es `sidonia.status`, no el inventario.

No cambies los ajustes **globales** de pago ni de inventario: los libros, láminas y demás productos normales deben seguir vendiéndose.

### Prueba recomendada en el duplicado (no se pudo hacer en el arnés)

- [ ] Intentar añadir una pieza al carrito desde la consola del navegador:
  `fetch('/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:VARIANTE,quantity:1})})`
  → debe responder error de existencias.
- [ ] Comprobar que la pieza sigue visible en su colección y en la búsqueda.
- [ ] Comprar un producto normal hasta el pago de prueba: debe funcionar igual que antes.
