import crypto from "node:crypto";

export function verifyMetaWebhookSignature({ rawBody, signature, appSecret }) {
  const secret = String(appSecret || "");
  const received = String(signature || "");

  if (!secret || !rawBody || !received.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}
