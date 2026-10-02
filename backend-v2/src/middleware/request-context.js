import multer from "multer";

const uploadErrors = {
  LIMIT_FILE_SIZE: [413, "El archivo supera el tamaño máximo permitido."],
  LIMIT_FILE_COUNT: [413, "Se superó la cantidad de archivos permitida."],
  LIMIT_PART_COUNT: [413, "La carga contiene demasiados campos o archivos."],
  LIMIT_FIELD_COUNT: [413, "La carga contiene demasiados campos."],
  LIMIT_FIELD_VALUE: [413, "Un campo de la carga supera el tamaño permitido."],
  LIMIT_FIELD_KEY: [400, "Un nombre de campo de la carga es demasiado largo."],
  LIMIT_FIELD_NESTING: [400, "La estructura de campos de la carga es demasiado profunda."],
  LIMIT_FIELD_ARRAY_INDEX: [400, "La estructura de campos de la carga no está permitida."],
  LIMIT_UNEXPECTED_FILE: [400, "La carga contiene un archivo no esperado."]
};

export function requestContext(req, res, next) {
  const requestId = req.headers["x-request-id"] || `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

export function apiErrorHandler(error, req, res, _next) {
  const uploadError = error instanceof multer.MulterError ? uploadErrors[error.code] : null;
  const status = Number(uploadError?.[0] || error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const detail = process.env.NODE_ENV === "production" ? undefined : error?.message;

  console.error(JSON.stringify({
    event: "api.request.failed",
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl || req?.url,
    status: safeStatus,
    name: error?.name,
    message: error?.message,
    code: error?.code,
    stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
  }));

  res.status(safeStatus).json({
    error: uploadError?.[1] || (safeStatus === 500 ? "Error interno del servidor" : (error?.message || "Solicitud inválida")),
    requestId: req?.requestId,
    detail
  });
}
