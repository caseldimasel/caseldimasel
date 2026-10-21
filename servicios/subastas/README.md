# Motor de Sidonia: anuncios de dueños (gratis) y subastas

Las pujas de verdad. El tema de Shopify ya tiene las pantallas (ficha, puja directa y máxima, registro, comentarios,
«¡Has ganado!»); con el **modo demostración** apagado, en vez de simular habla con este motor a través de
`sidonia.es/apps/subastas/…`.

- **Base de datos (Supabase / PostgreSQL):** `sql/esquema.sql`. Toda la lógica de pujar está ahí y se resuelve
  bloqueando la subasta, de una puja en una: aunque pujen cientos de personas a la vez, ninguna se pisa (probado con
  100 pujas simultáneas). Puja máxima automática, empates (gana la que llegó antes), cierre suave, reserva secreta,
  pujas repetidas que no cuentan dos veces y cierre con «vendida» o «reserva no alcanzada».
- **Servidor (Vercel):** `api/proxy.js` + `lib/motor.mjs`. Comprueba la firma del proxy de Shopify (así sabemos qué
  cliente puja y nadie puede hacerse pasar por otro), y hace el registro: nombre de usuario y tarjeta guardada con
  Stripe (Checkout en modo «setup»: no se cobra nada al registrarse).
- Sin dependencias: Node 18+, `fetch` y las APIs REST de Supabase y Stripe.

## Puesta en marcha

1. **Supabase**: crea un proyecto (región UE). En *SQL Editor* pega `sql/esquema.sql` y ejecútalo. En *Project
   Settings › API Keys* copia la *secret key* (`sb_secret_…`) o, en «Legacy API keys», la *service_role* (las dos
   valen; es secreta: solo va en Vercel). La URL es `https://<id-del-proyecto>.supabase.co`.
2. **Stripe**: crea la cuenta de Sidonia y copia la *secret key* (empieza por `sk_test_` mientras pruebas).
3. **App de Shopify** (Partners › Apps › Crear app). En *Configuración › Proxy de la app*: prefijo `apps`, subruta
   `subastas`, URL `https://<tu-servidor>.vercel.app/proxy`. Instálala en la tienda y copia el *secreto de cliente*.
4. **Vercel**: nuevo proyecto con este repositorio, *Root Directory* `servicios/subastas`, y las variables:

   | Variable | Qué es |
   | --- | --- |
   | `SHOPIFY_APP_SECRET` | Secreto de cliente de la app de Shopify (firma del proxy) |
   | `SUPABASE_URL` | URL del proyecto de Supabase |
   | `SUPABASE_SERVICE_KEY` | *secret key* (`sb_secret_…`) o *service_role* de Supabase |
   | `STRIPE_SECRET_KEY` | Clave secreta de Stripe |
   | `TIENDA_URL` | `https://sidonia.es` |
   | `SUBASTAS_CLAVE` | Una contraseña larga inventada; la misma va en el tema (*Clave del motor*) |

5. **Tema**: Personalizar › Ajustes del tema › Sidonia · Subastas › pon la **Clave del motor** (la misma que
   `SUBASTAS_CLAVE`) y desmarca **Modo demostración**.
6. **Crear una subasta**: en Shopify, sin tocar Supabase. Producto con la plantilla «subasta» y los metacampos
   `subasta.inicio` y `subasta.fin` (fecha y hora), `subasta.precio_salida` (entero) y, si tiene reserva,
   `subasta.reserva` (entero). La primera vez que se abre la ficha, el tema manda esos datos firmados con la clave
   (la reserva, cifrada: no se ve en la página) y el motor crea la subasta. Si luego cambias los metacampos, se pone
   al día al abrir la ficha: sin pujas se puede cambiar todo; con pujas, solo el final y la reserva.

   Para crearla a mano (o si no usas la clave):

   ```sql
   insert into subastas (handle, titulo, inicio, fin, salida, reserva)
   values ('porsche-912-1967', 'Porsche 912 1967', '2026-11-02 18:00+01', '2026-11-09 20:00+01', 30000, 45000);
   ```

   Si ya tenías el esquema de antes, ejecuta una vez `sql/actualizacion-2026-10-sincronizar.sql`.


## Anuncios de dueños (gratis): coches, motos, barcos y casas

Cualquiera con cuenta en Sidonia (particular o profesional) puede publicar **un anuncio gratis** (coche, moto, barco o casa) desde
`sidonia.es/pages/publicar` (hay que iniciar sesión): tipo, lo básico, ficha técnica, descripción breve, historia, descripción mecánica, fotos
(mínimo `CIRCULO_FOTOS_MIN`, 8 por defecto; máximo 30) y contacto. Las fotos se suben directas a Supabase Storage (cubo
«anuncios») con permisos firmados por el servidor. El equipo lo revisa en el **panel** y, al aprobarlo, el motor crea
la ficha en Shopify (plantilla «cars»; etiquetas `COCHES|MOTOS|BARCOS|CASAS`, así entra en sus colecciones, más `dueno`,
`particular|profesional` y `vendedor-<perfil>`; metacampos `custom.vendedor_nombre`, `custom.vendedor_slug`,
`custom.vendedor_telefono`, `custom.vendedor_tipo`, los de los filtros si se pueden, fotos y precio) y la publica en la tienda.

Puesta en marcha:

1. **Supabase › SQL Editor:** ejecuta `sql/circulo.sql` (crea la tabla, el límite de uno por persona y el cubo de fotos).
2. **App de Shopify (Dev Dashboard) › nueva versión:** añade los permisos `write_products`, `read_publications` y
   `write_publications` (además de `write_app_proxy`), publícala y acepta la actualización en la tienda.
3. **Vercel › variables:** `SHOPIFY_TIENDA` (`xxxx.myshopify.com`), `SHOPIFY_CLIENT_ID` (ID de cliente de la app) y
   `ADMIN_CLAVE` (contraseña del panel). Redeploy.
4. **Shopify (opcional):** sin crear nada, el formulario está en `/pages/vende-con-nosotros?view=publicar`, el perfil en
   `?view=perfil` y cada vendedor en `/collections/all/vendedor-<perfil>?view=vendedor`. Para las motos, una colección
   automática «Motos» (etiqueta = `MOTOS`). Más de un anuncio por persona: lo gestiona el equipo a mano.
5. **Panel:** `https://<tu-servidor>.vercel.app/admin` (usuario: cualquiera; contraseña: `ADMIN_CLAVE`).

| Ruta (detrás de `/apps/subastas`) | |
| --- | --- |
| `GET api/anuncio` | El anuncio activo (o el último) del cliente |
| `GET api/anuncios` | Todos sus anuncios (su perfil) |
| `POST api/anuncio/fotos` | `{ tipos: ['image/jpeg', …] }` → direcciones firmadas para subir cada foto |
| `POST api/anuncio` | La solicitud completa → `pendiente` (o `{ error: 'limite' }` si ya tiene uno activo) |

## Rutas (detrás de `/apps/subastas`)

| Ruta | |
| --- | --- |
| `GET api/estado?h=a,b` | Estado de una o varias subastas, visto por quien mira |
| `POST api/pujar` | `{ handle, importe, tipo: 'directa' \| 'maxima', intento }` |
| `POST api/comentar` | `{ handle, texto, respuesta_a }` |
| `POST api/seguir` | `{ handle, on }` |
| `POST api/sincronizar` | `{ datos, firma }`: la ficha crea o pone al día su subasta (datos firmados por el tema) |
| `GET conexion` | Página de comprobación: dice si la firma y la base de datos están bien |
| `GET/POST registro` | Página de registro (dentro del tema) → Stripe → `registro/vuelta` → vuelta a la ficha |

## Pruebas

```sh
npm test                                   # firma, rutas y registro (sin servicios)
PGTEST="-h localhost -U postgres" npm test # además, el motor contra un PostgreSQL de verdad
```

## Siguiente (paso 4)

- Cobrar la comisión al ganador con su tarjeta guardada y avisar por email (ganas, te superan, termina pronto).
- Retener la comisión en la tarjeta al pujar.
- Verificar el móvil por SMS en el registro.
- Pasar a Shopify la puja actual al terminar (metacampos), para que el listado quede bien aunque no haya JavaScript.
- Responder comentarios como «Vendedor» o «Sidonia».
