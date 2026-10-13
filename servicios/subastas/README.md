# Motor de subastas de Sidonia

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

5. **Tema**: Personalizar › Ajustes del tema › Sidonia · Subastas › desmarca **Modo demostración** (la dirección del
   motor ya es `/apps/subastas`).
6. **Crear una subasta** (por ahora en Supabase › *Table editor* › `subastas`, o con SQL):

   ```sql
   insert into subastas (handle, titulo, inicio, fin, salida, reserva)
   values ('porsche-912-1967', 'Porsche 912 1967', '2026-11-02 18:00+01', '2026-11-09 20:00+01', 30000, 45000);
   ```

   El `handle` es el del producto en Shopify (con la plantilla «subasta» y los metacampos `subasta.inicio`, `subasta.fin`
   y `subasta.precio_salida`). `reserva` vacía = sin reserva.

## Rutas (detrás de `/apps/subastas`)

| Ruta | |
| --- | --- |
| `GET api/estado?h=a,b` | Estado de una o varias subastas, visto por quien mira |
| `POST api/pujar` | `{ handle, importe, tipo: 'directa' \| 'maxima', intento }` |
| `POST api/comentar` | `{ handle, texto, respuesta_a }` |
| `POST api/seguir` | `{ handle, on }` |
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
- Panel para crear subastas y responder comentarios como «Vendedor» o «Sidonia».
