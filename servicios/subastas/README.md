# Motor de Sidonia: anuncios de dueños (gratis) y subastas

Las pujas de verdad. El tema de Shopify ya tiene las pantallas (ficha, puja directa y máxima, registro, comentarios,
«¡Has ganado!»); con el **modo demostración** apagado, en vez de simular habla con este motor a través de
`sidonia.es/apps/sidonia/…`.

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
   `sidonia`, URL `https://<tu-servidor>.vercel.app/proxy`. Instálala en la tienda y copia el *secreto de cliente*.
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

### Avisos al equipo

- **Cada anuncio enviado llega al correo de la tienda** sin configurar nada: el tema lo manda también por el formulario
  de contacto de Shopify (con todos los datos y los enlaces a las fotos). Si el motor falla, el anuncio llega igual y se
  le dice a quien anuncia que le pediremos las fotos por WhatsApp.
- **Con Resend** (opcional, las mismas claves que el servidor de ofertas) el motor manda además un email con fotos:
  `RESEND_API_KEY`, `AVISOS_EQUIPO` (o `OFERTAS_EQUIPO`) y `AVISOS_REMITENTE` (o `OFERTAS_REMITENTE`).
  Con `AVISOS_CLIENTES=1`, también un email cuando alguien entra por primera vez con su cuenta.
- **Registros e inicios de sesión:** el tema apunta cada entrada con cuenta (una por sesión del navegador) y el panel
  lo enseña en **/admin › Clientes** (nuevos hoy, esta semana, quién ha entrado y cuándo). Para un email por cada
  registro sin servidor de correo: Shopify Flow › «Customer created» › «Send internal email».

### El dueño edita o elimina su anuncio

- **Editar** (en «Anuncia gratis» o en su perfil › «Editar o eliminar»): el mismo formulario con sus datos y fotos. Si
  el anuncio aún está por revisar, se cambia directamente. Si ya está aprobado o publicado, los cambios quedan en
  **panel › Cambios** (antes y ahora, fotos incluidas): «Aprobar cambios» actualiza el anuncio y su ficha de Shopify;
  «No aprobar» lo deja como estaba. Al dueño le llega un email en los dos casos.
- **Eliminar:** el anuncio pasa a «Retirado», su ficha de Shopify se archiva y puede publicar otro.
- **En venta / Reservado / Vendido** (anuncio publicado; el dueño en su anuncio y el equipo en el panel): pone la
  etiqueta `reservado` o `vendido` a la ficha (la misma que en los coches de Sidonia). Vendido deja de contar como su
  anuncio gratis (puede publicar otro) y sale en panel › Vendido.
- Necesita las columnas `revision`, `revision_fecha` y `reservado` y el estado «vendido»: ejecuta otra vez `sql/circulo.sql` en Supabase › SQL Editor
  (no borra nada).

### Perfil del vendedor

- En **Mi perfil › Editar perfil** cada uno pone su **foto o logo**, el **nombre** que se ve (persona o negocio:
  «Automóviles ARPI SL»), si vende como **particular o profesional** y una **descripción breve**. Se guarda en la tabla
  `perfiles` (api/perfil) y se ve en su perfil público y en la ficha de sus anuncios (api/perfil/publico, sin sesión).
  Al cambiar el nombre o el tipo, sus anuncios publicados se actualizan también en Shopify.
- **Perfil de Sidonia:** `/collections/vendors?q=Sidonia&view=vendedor`, todos los productos con vendor «Sidonia».
  En la ficha de cada uno: «Propietario: Carlos · Venta gestionada por Sidonia» (enlaza al perfil de Sidonia).
- **Panel › Propietarios** saca el nombre del dueño de la historia de cada producto de Sidonia («Carlos lleva…») y lo
  pone en el metacampo `custom.propietario` (lib/propietarios.mjs). Las tarjetas enseñan la ubicación
  (`custom.provincia`) y el dueño o propietario.
- **Panel › Ubicaciones** lee la descripción de cada producto («📍 Ubicación: Pozuelo de Alarcón»), saca la provincia
  (Madrid) y la pone en `custom.provincia` (la tarjeta y el filtro «Localización») y como etiqueta del producto
  (lib/ubicaciones.mjs). Los anuncios gratis ya la llevan al publicarse.

### Panel: editar y emails al dueño

- **Editar antes de publicar** (anuncios por revisar o aprobados): título, precio, ubicación, textos, ficha técnica
  (una línea por dato, «Año: 1987»), vendedor, teléfono y fotos (quitar y elegir portada). «Guardar cambios» y después
  «Aprobar y publicar». Se guarda directamente en la tabla `anuncios` con la clave de servicio (no hace falta SQL nuevo).
- **Emails al dueño** (lib/correos.mjs, con Resend): «Hemos recibido tu anuncio» al enviarlo, «¡Enhorabuena!» con el
  enlace al publicarlo y «Aún no podemos publicarlo» con el motivo que escribas al rechazarlo. En el panel se puede
  desmarcar «Avisar al dueño por email». Hace falta `RESEND_API_KEY` y `AVISOS_REMITENTE` con un dominio verificado en
  Resend (por ejemplo `Sidonia <hola@sidonia.es>`); sin Resend el panel dice que no se ha enviado.

| Ruta (detrás de `/apps/sidonia`) | |
| --- | --- |
| `GET api/anuncio` | El anuncio activo (o el último) del cliente |
| `GET api/anuncios` | Todos sus anuncios (su perfil) |
| `POST api/visita` | `{ email, nombre }`: apunta que ha entrado con su cuenta (panel › Clientes) |
| `POST api/anuncio/fotos` | `{ tipos: ['image/jpeg', …] }` → direcciones firmadas para subir cada foto |
| `POST api/anuncio` | La solicitud completa → `pendiente` (o `{ error: 'limite' }` si ya tiene uno activo) |

### Avisos al móvil (app de las tiendas)

La app de iPhone y Android (carpeta `app/` del repositorio, con su guía) guarda cada móvil con
`POST api/push/registrar { token, plataforma }`. Se puede llamar sin sesión; si el cliente ha entrado, va con su firma.
El móvil queda en la tabla `dispositivos`, que crea `sql/circulo.sql`. Desde aquí se mandan con Firebase (`lib/avisos.mjs`):

- **al dueño**, cuando el panel publica o rechaza su anuncio, o aprueba sus cambios (si está marcado «Avisar al dueño»);
- **a todos los que tienen la app** (tema `novedades`), desde el panel › **Avisos**.

Variable en Vercel: `FIREBASE_SERVICE_ACCOUNT`, con el JSON de la cuenta de servicio de Firebase (tal cual o en
base64). `GET /api/salud` dice si es válida.

### Alertas de búsqueda («Avísame cuando entre uno así»)

En una búsqueda o colección, con sus filtros, la campana **Crear alerta** guarda lo que se está mirando (hace falta la
cuenta: así la gente se registra). Una vez al día (07:10 UTC, `crons` de `vercel.json`) se repasan los anuncios nuevos
de la tienda y a quien le encaje alguno le llega un email con las fichas (Resend) y un aviso al móvil si tiene la app.
En el tema: `snippets/sidonia-alerta.liquid` y Mi perfil › Mis alertas (para quitarlas). Código: `lib/alertas.mjs`.

Para ponerlo en marcha:
1. Supabase › SQL Editor: ejecuta otra vez `sql/circulo.sql` (crea la tabla `alertas`).
2. Vercel › Settings › Environment Variables: `CRON_SECRET` (una contraseña larga cualquiera; Vercel la manda sola en
   el cron). Sin ella, el repaso no se hace.
3. La app de Shopify necesita `read_products` (ya lo tiene para publicar).

### Estadísticas (panel › Estadísticas)

La web apunta, sin datos personales, lo que pasa: visitas (con de dónde vienen: Instagram, Google, WhatsApp…), fichas
vistas, contactos (WhatsApp, llamada, email, o «les pedimos la cuenta»), me gusta, compartidos, búsquedas, alertas y
ofertas (`snippets/sidonia-estadisticas.liquid` del tema → `POST /tienda/api/evento`). El panel lo resume por periodo
(7 días, 30 días, 3 meses, 1 año), comparando con el periodo anterior, con la gráfica por día y la tabla por anuncio.

Para ponerlo en marcha: Supabase › SQL Editor, ejecuta `sql/estadisticas.sql` (se puede repetir). Se cuenta desde ese
momento. `/api/salud?prueba=1` dice si está (`estadisticas: ok`). Código: `lib/estadisticas.mjs`.

## Rutas (detrás de `/apps/sidonia`)

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
