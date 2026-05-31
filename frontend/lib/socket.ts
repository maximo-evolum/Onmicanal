import { io } from "socket.io-client";
import { TOKEN_COOKIE, TOKEN_STORAGE_KEY } from "./constants";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getSocketToken() {
  return (
    getCookie(TOKEN_COOKIE) ||
    (typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null)
  );
}

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  auth: (cb) => {
    cb({ token: getSocketToken() });
  }
});
