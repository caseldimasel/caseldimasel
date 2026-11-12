# SIDONIA · Proyecto de Xcode de la app (después de `npm run nativo`): añade GoogleService-Info.plist a la app, enlaza
# App.entitlements (avisos de Apple) y pone la versión. Usa la gema xcodeproj, que viene con CocoaPods (Codemagic la tiene).
# Uso: ruby scripts/ios.rb
require 'xcodeproj'

proyecto = Xcodeproj::Project.open('ios/App/App.xcodeproj')
app = proyecto.targets.find { |t| t.name == 'App' } or abort('No encuentro el target App')
grupo = proyecto.main_group['App'] or abort('No encuentro el grupo App')

# GoogleService-Info.plist como recurso de la app (Firebase lo busca dentro del paquete)
if File.exist?('ios/App/App/GoogleService-Info.plist') && grupo.files.none? { |f| f.path == 'GoogleService-Info.plist' }
  ref = grupo.new_reference('GoogleService-Info.plist')
  app.resources_build_phase.add_file_reference(ref, true)
  puts '✓ GoogleService-Info.plist en la app'
end

# Entitlements (aps-environment) y versión en todas las configuraciones (Debug y Release)
grupo.new_reference('App.entitlements') if grupo.files.none? { |f| f.path == 'App.entitlements' }
app.build_configurations.each do |c|
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
  c.build_settings['MARKETING_VERSION'] = ENV['APP_VERSION'] || '1.0.0'
  c.build_settings['CURRENT_PROJECT_VERSION'] = (ENV['APP_BUILD'] || ENV['BUILD_NUMBER'] || '1').to_s
  c.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
end
puts '✓ App.entitlements, versión y iPhone + iPad'

proyecto.save
