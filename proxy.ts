import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const appPath =
    base && pathname.startsWith(base)
      ? pathname.slice(base.length) || "/"
      : pathname;

  if (appPath.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (
    appPath === "/manifest.webmanifest" ||
    appPath === "/manifest.json" ||
    appPath.startsWith("/icons/") ||
    appPath.startsWith("/images/") ||
    appPath === "/preview.png"
  ) {
    return NextResponse.next();
  }

  if (appPath.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie:
      process.env.AUTH_URL?.startsWith("https") ?? !isDevelopmentEnvironment,
  });

  if (!token) {
    const redirectUrl = encodeURIComponent(new URL(request.url).pathname);

    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  const isGuest = guestRegex.test(token?.email ?? "");

  if (token && !isGuest && ["/login", "/register"].includes(appPath)) {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|manifest.json|icons/|images/|preview.png).*)",
  ],
};
