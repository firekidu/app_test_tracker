import { NextResponse, type NextRequest } from 'next/server';

// Page redirects only. Must NOT match /api/* (Next.js would buffer and cut request bodies at 10 MB).
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|fonts).*)'] };

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = req.cookies.getAll().some((c) => /(^|\.)better-auth\.session_token$/.test(c.name));
  if (pathname === '/login') return NextResponse.next();
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname !== '/' || search ? `?next=${encodeURIComponent(pathname + search)}` : '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
