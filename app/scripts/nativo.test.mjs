import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archivoDeVariable, parcheAppDelegate, parcheGradle, parcheInfoPlist, parcheManifest } from './nativo.mjs';

// Lo que crea `npx cap add` (plantillas de Capacitor 7, recortadas)
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name"></application>
    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;
const GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "es.sidonia.app"
    defaultConfig {
        applicationId "es.sidonia.app"
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
`;
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Sidonia</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>UIViewControllerBasedStatusBarAppearance</key>
	<true/>
</dict>
</plist>
`;
const DELEGATE = `import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }
}
`;

test('Android: permiso de avisos (una sola vez) y versión', () => {
  const m = parcheManifest(MANIFEST);
  assert.match(m, /POST_NOTIFICATIONS" \/>\n<\/manifest>/);
  assert.equal(parcheManifest(m), m, 'no se repite');
  const g = parcheGradle(GRADLE, { version: '1.2.0', build: '37' });
  assert.match(g, /versionCode 37/);
  assert.match(g, /versionName "1.2.0"/);
  assert.match(g, /^android \{\n    signingConfigs \{\n        release \{\n            if \(System\.getenv\("CM_KEYSTORE_PATH"\)\)/m);
  assert.match(g, /release \{\n            signingConfig signingConfigs\.release\n            minifyEnabled false/);
  assert.equal(parcheGradle(g, { version: '1.2.0', build: '37' }), g, 'no se repite');
  assert.equal((g.match(/\{/g) || []).length, (g.match(/\}/g) || []).length);
});

test('iPhone: Info.plist con permisos, avisos en segundo plano, cifrado y versión', () => {
  const p = parcheInfoPlist(PLIST, { version: '1.2.0', build: '37' });
  assert.match(p, /<key>NSCameraUsageDescription<\/key>\s*<string>Para hacer las fotos/);
  assert.match(p, /<key>NSPhotoLibraryUsageDescription<\/key>/);
  assert.match(p, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>remote-notification<\/string>/);
  assert.match(p, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(p, /<key>CFBundleShortVersionString<\/key>\s*<string>1.2.0<\/string>/);
  assert.match(p, /<key>CFBundleVersion<\/key>\s*<string>37<\/string>/);
  assert.match(p, /<\/dict>\n<\/plist>\n$/);
  assert.equal(parcheInfoPlist(p, { version: '1.2.0', build: '37' }), p, 'se puede repetir sin duplicar');
  assert.equal((p.match(/NSCameraUsageDescription/g) || []).length, 1);
});

test('iPhone: AppDelegate arranca Firebase y le pasa el token de Apple', () => {
  const s = parcheAppDelegate(DELEGATE);
  assert.match(s, /import Capacitor\nimport FirebaseCore\n/);
  assert.match(s, /didFinishLaunchingWithOptions[^{]*\{\n.*\n\s*if FirebaseApp\.app\(\) == nil, Bundle\.main\.path\(forResource: "GoogleService-Info", ofType: "plist"\) != nil \{ FirebaseApp\.configure\(\) \}/);
  assert.match(s, /didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data\) \{\n\s*NotificationCenter\.default\.post\(name: \.capacitorDidRegisterForRemoteNotifications/);
  assert.match(s, /capacitorDidFailToRegisterForRemoteNotifications/);
  assert.equal(parcheAppDelegate(s), s, 'no se repite');
  // Llaves equilibradas: el código sigue compilando
  assert.equal((s.match(/\{/g) || []).length, (s.match(/\}/g) || []).length);
});

test('variables de Firebase: el archivo tal cual o en base64', () => {
  assert.equal(archivoDeVariable('{"a":1}'), '{"a":1}');
  assert.equal(archivoDeVariable(Buffer.from('<plist/>').toString('base64')), '<plist/>');
  assert.equal(archivoDeVariable(''), '');
});

test('capacitor.config.json: abre sidonia.es como app, con la pantalla sin conexión', () => {
  const c = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'));
  assert.equal(c.appId, 'es.sidonia.app');
  assert.match(c.server.url, /^https:\/\/sidonia\.es\/\?origen=app$/);
  assert.equal(c.server.errorPath, 'offline.html');
  assert.equal(c.appendUserAgent, 'SidoniaApp');
  assert.ok(c.server.allowNavigation.includes('*.shopify.com'), 'el acceso de clientes de Shopify se queda dentro de la app');
});
