# App de Sidonia (iPhone, iPad y Android)

La app abre **sidonia.es** dentro de una app nativa (Capacitor). Todo lo que se cambia en Shopify se ve en la app al
momento, sin publicar versiones nuevas. Además de la web, la app tiene:

- **Avisos al móvil** (Firebase):
  - «Ya está publicado» al dueño de un anuncio, y también «Sobre tu anuncio» y «Tus cambios ya se ven».
  - Avisos a todos desde el panel › **Avisos** («Acaba de llegar…»).
- **Cámara y fotos** para «Anuncia gratis».
- **Compartir** con el menú del móvil.
- **Pantalla sin conexión** con la marca (`www/offline.html`).
- **Icono y pantalla de carga** con la «O» y el logo (`assets/`).

En el tema, la parte de la app está en `layout/theme.liquid`, en el bloque «App de las tiendas», y en
`snippets/sidonia-app-head.liquid`. Ese bloque se encarga de pedir permiso para los avisos y de guardar el móvil en el
motor. Dentro de la app no se ofrece entrar con Google ni con Facebook, porque Google no lo permite en apps así.

No hace falta un Mac: **Codemagic** compila en sus Mac en la nube y sube la app a TestFlight y a Google Play.
Las carpetas `android/` e `ios/` no van en el repositorio, porque se crean en cada compilación con `npm run nativo`
(ver `scripts/nativo.mjs` y `scripts/ios.rb`).

---

## 1 · Firebase (avisos al móvil) — 15 minutos, gratis

1. Entra en [console.firebase.google.com](https://console.firebase.google.com) › **Crear un proyecto** › nombre
   `Sidonia`. Puedes quitar Google Analytics.
2. **Añadir app › Android**:
   - Nombre del paquete: `es.sidonia.app`.
   - Descarga **google-services.json**.
3. **Añadir app › Apple (iOS)**:
   - ID del paquete: `es.sidonia.app`.
   - Descarga **GoogleService-Info.plist**.
4. **Cuenta de servicio, para que el motor mande avisos:**
   - Ve a Configuración del proyecto ⚙️ › **Cuentas de servicio** › **Generar nueva clave privada**. Se descarga un `.json`.
   - En **Vercel** › proyecto *sidonia-platform* › Settings › Environment Variables, añade
     `FIREBASE_SERVICE_ACCOUNT` y pega dentro **todo el contenido** de ese `.json`.
   - Vuelve a desplegar.
   - Compruébalo en `https://sidoniaplatform.vercel.app/api/salud`: tiene que poner
     `"FIREBASE_SERVICE_ACCOUNT": true`.
5. Vuelve a ejecutar `servicios/subastas/sql/circulo.sql` en **Supabase › SQL Editor**. Crea la tabla `dispositivos`.

> No subas estos archivos al repositorio ni los pegues en ningún chat. Van solo en Vercel y en Codemagic.

## 2 · Apple (cuando esté aprobada la cuenta de empresa)

1. **developer.apple.com › Certificates, IDs & Profiles › Identifiers › +** › App IDs › App:
   - Descripción: `Sidonia`.
   - Bundle ID explícito: `es.sidonia.app`.
   - Marca **Push Notifications**.
2. **Keys › +** › nombre `Sidonia avisos` › marca **Apple Push Notifications service (APNs)** › descarga el `.p8`.
   Apunta también el **Key ID** y tu **Team ID**, que sale arriba a la derecha.
3. En **Firebase** › Configuración del proyecto › **Cloud Messaging** › app de Apple › *Clave de autenticación de APNs*
   › sube el `.p8` con su Key ID y Team ID.
4. **appstoreconnect.apple.com › Apps › +** › Nueva app:
   - Plataforma: iOS.
   - Nombre: `Sidonia`.
   - Idioma principal: español.
   - Bundle ID: `es.sidonia.app`.
   - SKU: `sidonia-app`.
5. **App Store Connect › Usuarios y acceso › Integraciones › App Store Connect API › +**:
   - Nombre: `Codemagic`.
   - Acceso: **App Manager**.
   - Descarga la clave `.p8` y apunta el **Issuer ID** y el **Key ID**.

## 3 · Google Play — 25 € una sola vez

1. [play.google.com/console](https://play.google.com/console) › crea la cuenta de **organización** (Sidonia).
2. **Crear aplicación**:
   - Nombre: `Sidonia`.
   - Idioma: español.
   - Tipo: App.
   - Gratis.
3. Cuenta de servicio, para que Codemagic suba la app:
   - En Google Cloud, crea una cuenta de servicio y descarga su clave en JSON.
   - En Play Console › **Usuarios y permisos**, invita al correo de esa cuenta como *Administrador de versiones*.
   - Guía con capturas: docs.codemagic.io › Publishing › Google Play.

## 4 · Codemagic (compila y publica, sin Mac)

1. Entra en [codemagic.io](https://codemagic.io) con tu cuenta de GitHub › **Add application** › repositorio
   `caseldimasel/caseldimasel` › usa el `codemagic.yaml` de la raíz.
2. **Team settings › Environment variables** › grupo **`sidonia_firebase`**, con las dos variables marcadas como
   *Secret*. Cada archivo va en base64; en codemagic.io hay un conversor, y también vale cualquier web «file to base64»:
   - `GOOGLE_SERVICES_JSON` = el `google-services.json` en base64;
   - `GOOGLE_SERVICE_INFO_PLIST` = el `GoogleService-Info.plist` en base64.
3. Grupo **`sidonia_google_play`**: `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` = el JSON de la cuenta de servicio de Google
   Play, tal cual.
4. **Code signing identities › Android keystores** › *Generate keystore*, con la referencia **`sidonia_keystore`**.
   **Descárgala y guárdala en un sitio seguro**: sin ella no se pueden publicar actualizaciones en Google Play.
5. **Team settings › Integrations › App Store Connect** › añade la clave del paso 2.5 con el nombre **`Sidonia`**.
6. **Start new build**:
   - flujo **Sidonia · Android**: la app llega a Google Play › *Prueba interna*;
   - flujo **Sidonia · iPhone y iPad**: la app llega a **TestFlight**. Instala TestFlight en el iPad o el iPhone y
     pruébala.
7. Cuando esté bien:
   - en App Store Connect, rellena la ficha (lo de abajo) › **Enviar a revisión**;
   - en Play Console, pasa la versión de *Prueba interna* a *Producción*.

Para una versión nueva de la app, por ejemplo con otro icono o permisos, sube `APP_VERSION` en `codemagic.yaml` y vuelve
a compilar. **Los cambios de la web no necesitan versión nueva.**

## 5 · La ficha en las tiendas

- **Nombre:** Sidonia.
- **Subtítulo (iPhone):** Coches, motos, barcos y casas.
- **Categoría:** Compras (secundaria: Estilo de vida).
- **Descripción corta (Android):** Coches clásicos, motos, barcos y casas con alma. Anuncia gratis.
- **Descripción:**
  > Sidonia es el sitio de los coches, motos, barcos y casas con alma, contados por sus dueños.
  > Descubre cada anuncio con su historia, sus fotos y vídeos a pantalla completa. Guarda los que te gustan, sigue a
  > los dueños y recibe un aviso cuando llegue algo nuevo o baje de precio.
  > ¿Quieres vender? Anúncialo gratis en unos minutos desde el móvil, con las fotos de tu cámara, o déjanos la venta y
  > nos encargamos de todo.
- **Palabras clave (iPhone):** coches clásicos,motos,barcos,casas,segunda mano,vender coche,clásicos,anuncios
- **Política de privacidad:** la de Shopify, `https://sidonia.es/policies/privacy-policy`. Tiene que mencionar los
  avisos al móvil y las fotos.
- **Capturas:** del iPhone 6,9" (1320×2868) y del iPad 13". Hazlas con TestFlight, con la portada, una ficha,
  «Descubre», Explorar y «Anuncia gratis».
- **Nota para la revisión de Apple:** en *Información de la revisión*, explica que todo se puede ver sin cuenta y que
  solo hace falta entrar para anunciar, con un código que llega por email. Pon un correo de prueba vuestro (por ejemplo
  `revision@sidonia.es`) y vuestro teléfono: si Apple intenta entrar, os llega el código y se lo pasáis.

## Comprobar en local (sin compilar)

```bash
cd app && npm test   # parches de Android e iPhone, y la configuración
```
