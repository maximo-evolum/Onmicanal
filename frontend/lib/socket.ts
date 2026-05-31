import { io } from "socket.io-client";
import { TOKEN_COOKIE, TOKEN_STORAGE_KEY } from "./constants";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getSocketToken() {
  if (typeof window === "undefined") return getCookie(TOKEN_COOKIE);

  return (
    getCookie(TOKEN_COOKIE) ||
    window.localStorage.getItem(TOKEN_STORAGE_KEY) ||
    window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
    window.localStorage.getItem("token") ||
    window.localStorage.getItem("auth_token") ||
    window.localStorage.getItem("jwt")
  );
}

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  auth: (cb) => {
    cb({ token: getSocketToken() });
  }
});
