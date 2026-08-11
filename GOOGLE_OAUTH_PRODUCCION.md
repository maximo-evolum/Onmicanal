# Google OAuth para Gmail en EVOLUM

Este documento separa lo que ya queda preparado en el código de EVOLUM de lo
que debe configurarse manualmente en las consolas de Google, DNS y Railway.
No copies secretos, tokens ni archivos JSON a tickets, chats o formularios de
clientes.

## Lo que ya hace EVOLUM

- Conserva las credenciales de la aplicación de EVOLUM en variables privadas
  del backend; los clientes nunca las ingresan en Centro de Conexiones.
- Abre la autorización oficial de Google para que cada empresa vincule una
  cuenta externa que puede ser distinta de su cuenta EVOLUM.
- Solicita `gmail.send` y `gmail.readonly`, porque Inbox necesita responder y
  consultar correo. Los tokens se intercambian en el backend y no se devuelven
  al navegador.
- Normaliza `PUBLIC_BASE_URL` para que el callback no quede con una barra doble.

## Configuración inmediata para salir del error 403 durante pruebas

1. Abre [Google Auth Platform - Audience](https://console.cloud.google.com/auth/audience).
2. Selecciona el proyecto cuyo cliente OAuth termina en
   `s68icro3h1u35shcrkk2fub55e87ivpk.apps.googleusercontent.com`.
3. Si el estado de publicación es **Testing**, agrega el correo Google con que
   se hará la prueba en **Test users**. Guarda los cambios.
4. Espera unos minutos, cierra la pestaña de consentimiento anterior y vuelve a
   presionar **Vincular con Gmail** desde EVOLUM.

Una aplicación en modo de pruebas solo permite usuarios incluidos en esa lista.
No cambies los permisos Gmail de EVOLUM para evitar el error: Inbox requiere los
dos permisos indicados arriba.

## Configuración para producción

Antes de publicar, usa un dominio propio de EVOLUM. No bases la producción en
`*.railway.app`, porque el dominio verificable debe estar bajo control de
EVOLUM.

1. Crea `api.evolum.cl` en DNS apuntando al dominio público del servicio
   Backend-v2 de Railway y agrega ese dominio al servicio en Railway.
2. En Railway, establece:

   ```text
   PUBLIC_BASE_URL=https://api.evolum.cl
   BACKEND_PUBLIC_URL=https://api.evolum.cl
   ```

3. En Google Auth Platform > Branding, configura:
   - Nombre: **EVOLUM OS**
   - Correo de asistencia y contacto de desarrollador que controle EVOLUM
   - Página de inicio, Política de privacidad y Términos en `https://evolum.cl`
4. Verifica `evolum.cl` mediante Google Search Console y agrégalo como dominio
   autorizado en Google Auth Platform.
5. En Google Auth Platform > Clients, registra exactamente:

   ```text
   https://api.evolum.cl/api/connections/oauth/google/callback
   ```

6. En Google Auth Platform > Data access, conserva los permisos que usa
   EVOLUM y explica su uso real: lectura para Inbox, respuesta desde Inbox,
   adjuntos y trazabilidad dentro del tenant autorizado.
7. Publica la aplicación y envía la verificación que Google solicite. Los
   permisos de Gmail de EVOLUM son sensibles/restringidos; Google puede pedir
   verificación adicional y, si los datos restringidos se almacenan o
   transmiten en servidores, una evaluación de seguridad.

## Prueba final de aceptación

1. Entra a EVOLUM con un usuario administrador del tenant de prueba.
2. Abre **Centro de Conexiones > Correo / Gmail**.
3. Presiona **Vincular con Gmail** e inicia sesión con una cuenta distinta si
   corresponde.
4. Acepta el consentimiento y verifica que EVOLUM muestre la cuenta externa
   como vinculada.
5. Envía un correo de prueba desde Inbox y confirma trazabilidad sin revelar
   tokens ni secretos.

## Si continúa el 403

- Confirma que el correo usado esté en **Test users** si la app sigue en
  pruebas.
- Confirma que no existe una política de Google Workspace que bloquee apps de
  terceros.
- Confirma que la URI de redirección de Google coincide carácter por carácter
  con `PUBLIC_BASE_URL` y no tiene una barra final adicional.
- No pegues la contraseña de Google, `GOOGLE_CLIENT_SECRET` ni un token en
  EVOLUM. La conexión se hace siempre en la ventana oficial de Google.
