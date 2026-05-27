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

export function middleware(request: NextRequest) {
  const token = request.cookies.get("inbox_token");
  const session = readSession(request);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/register")) {
    if (token && session?.role === "SUPER_ADMIN") return NextResponse.redirect(new URL("/admin", request.url));
    if (token) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (!token) return NextResponse.redirect(new URL("/login", request.url));

  if (pathname.startsWith("/admin") && session?.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*", "/inbox", "/dashboard/:path*", "/pipeline/:path*", "/campaigns/:path*", "/dev/:path*", "/onboarding/:path*", "/login", "/register"]
};
