/** Archivo: Proporciona infraestructura y utilidades compartidas para socket. */
let ioInstance = null;

export function setIo(io) {
  ioInstance = io;
}

export function getIo() {
  if (!ioInstance) {
    throw new Error("Socket.IO no está inicializado");
  }
  return ioInstance;
}
