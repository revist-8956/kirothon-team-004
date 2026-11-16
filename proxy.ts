import type { NextRequest } from "next/server";

import { refreshSupabaseSession } from "./infrastructure/supabase/proxy-session";

export function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    // Skip static assets, image optimization and health probes (no session needed).
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
