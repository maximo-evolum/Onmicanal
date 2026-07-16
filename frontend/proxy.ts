import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function readSession(request: NextRequest): { role?: string } | null {
  const raw = request.cookies.get("inbox_session")?.value;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const session = readSession(request);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/register")) {
    if (session) return NextResponse.redirect(new URL("/crm-principal", request.url));
    return NextResponse.next();
  }

  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  // Los privilegios se validan en el backend con el usuario actual de la base
  // de datos. Este JSON del navegador puede quedar antiguo tras cambiar roles.

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/crm-principal/:path*",
    "/crm-concepts/:path*",
    "/agenda/:path*",
    "/ai-ops/:path*",
    "/campaigns/:path*",
    "/dashboard/:path*",
    "/dev/:path*",
    "/inbox/:path*",
    "/onboarding/:path*",
    "/payments/:path*",
    "/pipeline/:path*",
    "/saas/:path*",
    "/saas-analytics/:path*",
    "/sales-queue/:path*",
    "/settings/:path*",
    "/team/:path*",
    "/login",
    "/register",
  ]
};
