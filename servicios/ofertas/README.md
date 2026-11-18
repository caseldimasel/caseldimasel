# Servidor de ofertas de Sidonia

Cuando alguien pulsa **«Hacer una oferta»** en un coche, una casa o un barco de sidonia.es, el tema envía la oferta
aquí. Este pequeño servidor:

1. avisa al equipo por email («Nueva oferta: 21.000 € por PORSCHE 924 1984», respondiendo se escribe al cliente);
2. manda al cliente el email de **«¡Gracias por tu oferta!»**, con el resumen y el botón de WhatsApp.

Mientras no esté en marcha, las ofertas llegan igualmente al correo de la tienda por el formulario de contacto de
Shopify (sin email de gracias al cliente). Shopify no puede mandar ese email automático por sí solo: Shopify Flow
solo envía emails internos o de marketing a suscriptores.

Sin dependencias: Node 18 o más y la API de [Resend](https://resend.com) para los emails.

## Puesta en marcha (unos 15 minutos)

1. **Resend** (emails): crea una cuenta gratis (3.000 emails al mes), añade el dominio `sidonia.es` y copia en tu DNS
   los registros que te da (así los emails salen de `ofertas@sidonia.es` y no van a spam). Crea una *API key*.
2. **Vercel** (servidor): crea una cuenta gratis con tu GitHub, «Add New › Project», elige este repositorio y en
   *Root Directory* pon `servicios/ofertas`. Sin comandos de build.
3. En Vercel › *Settings › Environment Variables*, añade:

   | Variable | Ejemplo | Para qué |
   | --- | --- | --- |
   | `RESEND_API_KEY` | `re_…` | Enviar los emails |
   | `OFERTAS_EQUIPO` | `hola@sidonia.es` | Quién recibe el aviso (varios, separados por comas) |
   | `OFERTAS_REMITENTE` | `Sidonia <ofertas@sidonia.es>` | Remitente (del dominio verificado en Resend) |
   | `OFERTAS_ORIGENES` | `https://sidonia.es,https://www.sidonia.es` | Webs que pueden enviar ofertas |
   | `OFERTAS_CLAVE` | una frase larga al azar | Firma de los clientes con sesión iniciada |
   | `OFERTAS_SOLO_FIRMADAS` | `1` | (Opcional) Solo acepta ofertas de clientes con sesión |
   | `OFERTAS_WHATSAPP` | `34675287095` | Botón de WhatsApp del email de gracias |

   Si usas también la dirección `tutienda.myshopify.com`, añádela a `OFERTAS_ORIGENES`.
4. Despliega. Tu dirección será algo como `https://sidonia-ofertas.vercel.app/api/oferta`.
5. En Shopify › Tienda online › Personalizar › Ajustes del tema › **Sidonia · Ofertas**:
   - *Dirección del servidor de ofertas*: la de arriba;
   - *Clave del servidor de ofertas*: la misma frase que `OFERTAS_CLAVE`.
6. Haz una oferta de prueba desde la web: te llegará el aviso y, al cliente, el email de gracias.

## Inicio de sesión

Si en Shopify › Configuración › **Cuentas de cliente** están activadas (recomendado: las cuentas nuevas, que entran
con un código por email, sin contraseña) y el ajuste «Pedir iniciar sesión para ofertar» está marcado, para ofertar
hay que entrar antes. Así cada oferta viene de un email verificado. El tema firma la oferta
(`hmac_sha256` de `id:email:hora` con la clave) y este servidor comprueba la firma: nadie puede ofertar en nombre de
otra persona ni usar el servidor para mandar emails a quien quiera.

## Contrato

`POST /api/oferta` (JSON):

```json
{
  "handle": "porsche-924-1984", "titulo": "PORSCHE 924 1984", "url": "https://sidonia.es/products/porsche-924-1984",
  "precio": 23000, "oferta": 21000, "contexto": "venta",
  "nombre": "Lucía", "email": "lucia@ejemplo.es", "telefono": "+34 600 111 222", "mensaje": "Pago al contado",
  "cliente": { "id": "7001", "ts": "1760000000", "firma": "…" }
}
```

Respuestas: `200 { ok: true, email_enviado: true|false }`; `400` datos (`error`: `oferta`, `email`, `nombre`…);
`401` firma; `502` no se pudo avisar al equipo (el tema usa entonces el formulario de Shopify); `503` sin configurar.

## Pruebas

```sh
cd servicios/ofertas && npm test
```
