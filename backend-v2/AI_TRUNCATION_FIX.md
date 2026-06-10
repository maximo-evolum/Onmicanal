# Fix IA truncado y cierres duplicados

Cambios aplicados en `backend-v2/src/services/ai.service.js`:

1. Eliminado el truncado agresivo:
   - Antes cortaba respuestas sobre 520 caracteres con `slice(0, 500)`.
   - Ahora solo aplica protección extrema sobre 3200 caracteres y corta en cierre de frase.

2. Agregado `max_tokens: 1200` en la llamada directa a OpenAI para evitar respuestas incompletas.

3. Agregado limpiador de cierres duplicados:
   - Evita repetir preguntas tipo “¿Quieres que avancemos...?”
   - Mantiene una sola pregunta final comercial.

4. Reglas reforzadas en prompt:
   - No repetir cierres comerciales.
   - No cortar palabras ni frases.
   - Máximo 3 bloques, lectura fácil para WhatsApp.
   - Terminar siempre la idea completa.

Validación:
- `node --check` ejecutado sobre todos los `.js` del backend sin errores de sintaxis.
