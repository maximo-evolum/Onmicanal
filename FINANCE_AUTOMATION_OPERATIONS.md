# Operación automática de EVOLUM Finanzas

## Qué quedó automatizado

1. Una factura o un movimiento creado manualmente, importado desde CSV o sincronizado desde Nubox activa un análisis financiero posterior.
2. El análisis prepara conciliaciones, identifica excepciones y actualiza el espacio de trabajo de los agentes financieros.
3. Si aparecen excepciones nuevas, se crea una notificación para que una persona las revise.
4. Nubox puede sincronizarse manualmente desde **Finanzas > Integraciones financieras** y también en segundo plano.
5. Cada ejecución queda registrada en la bitácora: completada, con incidencia o análisis posterior preparado.

## Límites de seguridad deliberados

La automatización no confirma pagos, no cambia el ERP, no borra datos y no envía WhatsApp, correo o SMS. Las conciliaciones, actualizaciones contables y cobranzas requieren revisión y aprobación humana conforme a la política del tenant.

## Activación en Railway

Configura estas variables en `backend-v2` y despliega:

```env
ENABLE_AUTOMATION=true
FINANCE_NUBOX_SYNC_ENABLED=true
FINANCE_NUBOX_SYNC_INTERVAL_MS=21600000
FINANCE_NUBOX_SYNC_LIMIT=100
NUBOX_API_BASE_URL=https://<host-oficial-de-nubox>
```

`21600000` equivale a seis horas. Para validar antes, usa el botón **Sincronizar ahora** dentro de Finanzas. Redis debe responder `"redis":"connected"` en `/health/ready`.

## Ciclo de sincronización

1. El planificador encuentra cuentas con Nubox activo.
2. Redis impide que dos procesos sincronicen una misma cuenta al mismo tiempo.
3. EVOLUM consulta las ventas del período y reintenta fallos transitorios hasta tres veces.
4. Crea o actualiza facturas usando el identificador externo de Nubox, evitando duplicados.
5. Ejecuta análisis financiero y deja las decisiones sensibles pendientes de aprobación humana.
6. Guarda el resultado en la bitácora y notifica cuando hay documentos o excepciones nuevas.

## Conexiones futuras

Floid, bancos por API, Defontana, Softland, SII/DTE y canales de cobranza requieren contrato, credenciales, scopes, webhooks o consentimiento del cliente. Hasta contar con esos elementos quedan como conexión futura o carga manual; el sistema no inventa datos financieros ni simula integraciones.
