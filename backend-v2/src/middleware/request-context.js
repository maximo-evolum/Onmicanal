
export function requestContext(req, res, next) {
  const requestId = req.headers["x-request-id"] || `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

export function apiErrorHandler(error, req, res, _next) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const detail = process.env.NODE_ENV === "production" ? undefined : error?.message;

  console.error("[API_ERROR]", {
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl || req?.url,
    status: safeStatus,
    name: error?.name,
    message: error?.message,
    code: error?.code,
    stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
  });

  res.status(safeStatus).json({
    error: safeStatus === 500 ? "Error interno del servidor" : (error?.message || "Solicitud inválida"),
    requestId: req?.requestId,
    detail
  });
}
