/** Archivo: Proporciona infraestructura y utilidades compartidas para upload limits. */
// Limita los metadatos multipartes además de los bytes de archivos. El anidamiento e índices de Multer
// son opcionales; actualizar el paquete por sí solo no los habilita.
export function uploadLimits({ fileSize, files }) {
  return {
    fileSize,
    files,
    fields: 64,
    parts: files + 64,
    fieldSize: 1024 * 1024,
    fieldNameSize: 100,
    fieldNestingDepth: 8,
    fieldArrayIndexLimit: 1000
  };
}
