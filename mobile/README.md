# EVOLUM Mobile

App movil companion para EVOLUM. Usa el mismo backend que la web, por lo que los clientes, modulos, rubros, conversaciones, reservas, pagos y campanas se sincronizan desde la API central.

La app esta fijada en Expo SDK 54 para tener mejor compatibilidad con Expo Go en Android/Samsung.

## Ejecutar

```bash
cd E:\Onmicanal\mobile
npm install
npm run start
```

`npm run start` usa tunnel por defecto. Es la forma recomendada para probar en Samsung, Android, iPhone y telefonos que no estan en la misma red local que el PC.

 WiFi local:

```bash
npm run start:lan
```

Si aparece `Failed to download remote update` en Expo Go, cerrar Expo Go, volver a ejecutar:

```bash
npm run start
```

y escanea el QR que diga `Tunnel`.

Si Expo Go muestra `Project is incompatible with this version of Expo Go`, actualiza Expo Go desde Play Store o borra cache/datos de Expo Go y vuelve a escanear. Este proyecto ya esta en SDK 54 para evitar depender de SDK 56.

Configura `EXPO_PUBLIC_API_BASE_URL` con la URL publica del backend cuando pruebes desde un telefono fisico. En PowerShell:

```bash
$env:EXPO_PUBLIC_API_BASE_URL="https://tu-backend.up.railway.app/api"
npm run start
```

No uses `localhost` para un telefono fisico, porque en Android `localhost` apunta al propio telefono, no al PC.

## Distribución privada y actualizaciones

La app está preparada para distribución privada, sin depender de Expo Go en los teléfonos de uso diario:

- **Android:** genera una APK firmada, instalable desde un enlace privado. Cuando haya un cambio nativo, se genera otra APK y Android solicitará al usuario confirmar la instalación.
- **iPhone/iPad:** Apple no permite APK ni instalación directa general. La distribución privada se hace con **TestFlight**; activa sus actualizaciones automáticas para que los usuarios reciban los nuevos builds sin publicar la app en la búsqueda de App Store.
- **Cambios de pantallas, lógica y estilos:** se publican por EAS Update. La app busca una versión al abrirse, muestra el aviso de actualización y reinicia solo cuando el usuario lo acepta.

Antes de crear el primer build, inicia sesión con la cuenta corporativa de Expo y enlaza este proyecto una sola vez. Esto agregará el identificador y URL privada de actualizaciones al `app.json`:

```bash
cd E:\Onmicanal\mobile
npx eas-cli login
npx eas-cli init
npx eas-cli update:configure
```

Luego usa estos comandos:

```bash
# APK privada para Android
npm run build:android:apk

# Build iOS para subir a TestFlight (requiere Apple Developer)
npm run build:ios:testflight

# Actualización rápida de la app, sin nueva APK/IPA
npm run update:preview -- --message "Describe la mejora"
```

Los comandos de build ya evitan automáticamente el clonado temporal de todo el repositorio. Esto es importante en Windows porque el frontend puede mantener archivos bloqueados mientras está abierto en desarrollo.

Los cambios que agreguen permisos, dependencias nativas o funciones propias de Android/iOS requieren un nuevo build; los demás se publican mediante actualización OTA.

## Arquitectura

- `src/api/client.ts`: cliente API compartido conceptualmente con la web.
- `src/config/industryProfiles.ts`: perfiles por rubro para vistas y funcionalidades diferentes.
- `App.tsx`: primera app funcional con dashboard, inbox, agenda, pipeline, campanas y modo super admin.
