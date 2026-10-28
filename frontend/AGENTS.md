# Guía para desarrolladores del frontend

Este directorio contiene el frontend de EVOLUM OS, construido con Next.js 16,
React y TypeScript.

## Antes de modificar código

- Revisa la documentación correspondiente en `node_modules/next/dist/docs/`.
- Esta versión de Next.js incorpora cambios relevantes de APIs, convenciones y
  estructura frente a versiones anteriores.
- Considera los avisos de deprecación antes de crear o modificar rutas,
  componentes, configuraciones o llamadas del lado cliente.

## Validación mínima

Después de cambios en el frontend, ejecuta:

```powershell
npm run test:broker
npm run build
```

No incluyas secretos, tokens, credenciales ni archivos `.env` en commits.
