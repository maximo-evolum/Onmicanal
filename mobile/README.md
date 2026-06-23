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

Si quieres probar solo dentro de tu WiFi local:

```bash
npm run start:lan
```

Si aparece `Failed to download remote update` en Expo Go, cierra Expo Go, vuelve a ejecutar:

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

## Arquitectura

- `src/api/client.ts`: cliente API compartido conceptualmente con la web.
- `src/config/industryProfiles.ts`: perfiles por rubro para vistas y funcionalidades diferentes.
- `App.tsx`: primera app funcional con dashboard, inbox, agenda, pipeline, campanas y modo super admin.
