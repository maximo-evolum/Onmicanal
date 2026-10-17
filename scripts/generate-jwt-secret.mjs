/** Archivo: Contiene soporte versionado para generate jwt secret. */
import crypto from "node:crypto";

console.log(crypto.randomBytes(48).toString("hex"));
