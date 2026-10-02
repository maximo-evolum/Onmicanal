// Bound multipart metadata as well as file bytes. Multer's nesting/index
// protections are opt-in; an updated package alone does not enable them.
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
