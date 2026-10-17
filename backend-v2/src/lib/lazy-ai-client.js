/** Archivo: Proporciona infraestructura y utilidades compartidas para lazy ai client. */
// La configuración opcional de IA no debe impedir el inicio de la base de datos ni de HTTP.
export function createLazyAIClient({ readApiKey, createClient }) {
  let client, previousKey;
  return () => {
    const apiKey = String(readApiKey() || "").trim();
    if (!apiKey) {
      client = undefined;
      previousKey = undefined;
      throw Object.assign(new Error("El servicio de IA no está configurado. Contacta al administrador."), {
        status: 503, code: "AI_NOT_CONFIGURED"
      });
    }
    if (!client || apiKey !== previousKey) {
      client = createClient(apiKey);
      previousKey = apiKey;
    }
    return client;
  };
}
