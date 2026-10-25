/* SIDONIA · Prepara los proyectos nativos de la app (Android e iPhone) a partir de capacitor.config.json.
 *
 * Las carpetas android/ e ios/ no van en el repositorio: se crean aquí, en cada compilación (Codemagic), y se les
 * añade lo propio de Sidonia:
 *   - icono y pantalla de carga (assets/) con @capacitor/assets;
 *   - Firebase: google-services.json (Android) y GoogleService-Info.plist (iPhone), desde las variables
 *     GOOGLE_SERVICES_JSON y GOOGLE_SERVICE_INFO_PLIST (el archivo tal cual o en base64);
 *   - permisos: avisos (Android 13+), cámara y fotos (para «Anuncia gratis»), avisos en segundo plano (iPhone);
 *   - iPhone: AppDelegate que pasa el token de Apple a Firebase; los cambios en el proyecto de Xcode van en ios.rb;
 *   - número de versión: APP_VERSION (1.0.0) y APP_BUILD (el número de compilación de Codemagic).
 * Uso: npm run nativo   (después: Android → cd android && ./gradlew bundleRelease · iPhone → ruby scripts/ios.rb)
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEXTOS = {
  NSCameraUsageDescription: 'Para hacer las fotos de tu coche, moto, barco o casa al anunciarlo en Sidonia.',
  NSPhotoLibraryUsageDescription: 'Para elegir las fotos de tu anuncio y de tu perfil.',
  NSPhotoLibraryAddUsageDescription: 'Para guardar fotos de Sidonia en tu carrete.'
};

/** El contenido de una variable: el archivo tal cual o en base64 */
export function archivoDeVariable(valor) {
  const v = String(valor || '').trim();
  if (!v) return '';
  return v.startsWith('{') || v.startsWith('<') ? v : Buffer.from(v, 'base64').toString('utf8');
}

/** AndroidManifest.xml: permiso de avisos (Android 13+) */
export function parcheManifest(xml) {
  const permiso = '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />';
  if (xml.includes('android.permission.POST_NOTIFICATIONS')) return xml;
  return xml.replace(/(\s*)<\/manifest>\s*$/, `\n    ${permiso}\n</manifest>\n`);
}

/** android/app/build.gradle: firma con la clave de subida de Google Play (la guarda Codemagic) y número de versión */
export function parcheGradle(gradle, { version, build }) {
  let g = gradle;
  if (!g.includes('CM_KEYSTORE_PATH')) {
    g = g.replace(/^android\s*\{\n/m, `android {
    signingConfigs {
        release {
            if (System.getenv("CM_KEYSTORE_PATH")) {
                storeFile file(System.getenv("CM_KEYSTORE_PATH"))
                storePassword System.getenv("CM_KEYSTORE_PASSWORD")
                keyAlias System.getenv("CM_KEY_ALIAS")
                keyPassword System.getenv("CM_KEY_PASSWORD")
            }
        }
    }
`);
    g = g.replace(/(buildTypes\s*\{\s*release\s*\{\n)/, '$1            signingConfig signingConfigs.release\n');
  }
  if (build) g = g.replace(/versionCode\s+\d+/, `versionCode ${Number(build)}`);
  if (version) g = g.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  return g;
}

/** Info.plist: textos de permisos, avisos en segundo plano y sin cifrado propio (para no rellenarlo en cada versión) */
export function parcheInfoPlist(plist, { version, build } = {}) {
  let p = plist;
  const poner = (clave, valor) => {
    if (p.includes(`<key>${clave}</key>`)) {
      p = p.replace(new RegExp(`(<key>${clave}</key>\\s*)<(string|true|false)[^>]*?(?:/>|>[^<]*</string>)`), `$1${valor}`);
    } else {
      p = p.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${clave}</key>\n\t${valor}\n</dict>\n</plist>\n`);
    }
  };
  for (const [k, v] of Object.entries(TEXTOS)) poner(k, `<string>${v}</string>`);
  poner('ITSAppUsesNonExemptEncryption', '<false/>');
  if (!p.includes('<key>UIBackgroundModes</key>')) {
    p = p.replace(/<\/dict>\s*<\/plist>\s*$/, '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>remote-notification</string>\n\t</array>\n</dict>\n</plist>\n');
  } else if (!p.includes('<string>remote-notification</string>')) {
    p = p.replace(/(<key>UIBackgroundModes<\/key>\s*<array>)/, '$1\n\t\t<string>remote-notification</string>');
  }
  if (version) poner('CFBundleShortVersionString', `<string>${version}</string>`);
  if (build) poner('CFBundleVersion', `<string>${Number(build)}</string>`);
  return p;
}

/** AppDelegate.swift: arranca Firebase y le pasa el token de los avisos de Apple (lo pide @capacitor-firebase/messaging) */
export function parcheAppDelegate(swift) {
  if (swift.includes('capacitorDidRegisterForRemoteNotifications')) return swift;
  let s = swift.replace(/import Capacitor\n/, 'import Capacitor\nimport FirebaseCore\n');
  s = s.replace(/(didFinishLaunchingWithOptions[^{]*\{\n)/, '$1        if FirebaseApp.app() == nil { FirebaseApp.configure() }\n');
  s = s.replace(/(\n\s*var window: UIWindow\?\n)/, `$1
    // Avisos al móvil: el token de Apple va a Firebase (Capacitor lo reparte a @capacitor-firebase/messaging)
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`);
  return s;
}

export const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>aps-environment</key>
\t<string>production</string>
</dict>
</plist>
`;

function cambiar(ruta, fn) {
  if (!existsSync(ruta)) return console.warn(`· No existe ${ruta}`);
  const antes = readFileSync(ruta, 'utf8');
  const despues = fn(antes);
  if (despues !== antes) writeFileSync(ruta, despues);
  console.log(`✓ ${ruta}`);
}

function main() {
  const sh = (c) => { console.log(`$ ${c}`); execSync(c, { stdio: 'inherit' }); };
  const env = process.env;
  const v = { version: env.APP_VERSION || '1.0.0', build: env.APP_BUILD || env.BUILD_NUMBER || '' };
  const solo = process.argv[2];   // android | ios | (nada: los dos)

  if (solo !== 'ios' && !existsSync('android')) sh('npx cap add android');
  if (solo !== 'android' && !existsSync('ios')) sh('npx cap add ios');
  sh(`npx capacitor-assets generate${solo ? ` --${solo}` : ''} --iconBackgroundColor "#ffffff" --iconBackgroundColorDark "#ffffff" --splashBackgroundColor "#ffffff" --splashBackgroundColorDark "#ffffff"`);

  if (solo !== 'ios') {
    const gs = archivoDeVariable(env.GOOGLE_SERVICES_JSON);
    if (gs) { writeFileSync('android/app/google-services.json', gs); console.log('✓ android/app/google-services.json'); }
    else console.warn('· Sin GOOGLE_SERVICES_JSON: la app de Android no recibirá avisos');
    cambiar('android/app/src/main/AndroidManifest.xml', parcheManifest);
    cambiar('android/app/build.gradle', (g) => parcheGradle(g, v));
  }
  if (solo !== 'android') {
    const gi = archivoDeVariable(env.GOOGLE_SERVICE_INFO_PLIST);
    if (gi) { writeFileSync('ios/App/App/GoogleService-Info.plist', gi); console.log('✓ ios/App/App/GoogleService-Info.plist'); }
    else console.warn('· Sin GOOGLE_SERVICE_INFO_PLIST: la app de iPhone no recibirá avisos');
    cambiar('ios/App/App/Info.plist', (p) => parcheInfoPlist(p, v));
    cambiar('ios/App/App/AppDelegate.swift', parcheAppDelegate);
    writeFileSync('ios/App/App/App.entitlements', ENTITLEMENTS);
    console.log('✓ ios/App/App/App.entitlements (falta enlazarlo en Xcode: ruby scripts/ios.rb)');
  }
  sh(`npx cap sync${solo ? ` ${solo}` : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
