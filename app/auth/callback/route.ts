import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { completeGoogleSignIn } from "@/application/google-sign-in";
import { getAppOrigin } from "@/infrastructure/app-origin";
import { logger } from "@/infrastructure/logger";
import { repositories } from "@/infrastructure/prisma-repositories";
import { createSupabaseServerClientForCookies } from "@/infrastructure/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase OAuth (PKCE) callback. Session cookies written by the Supabase
 * server client and the cleared return-path cookie are attached to this
 * redirect response by Next.js.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const appOrigin = getAppOrigin();
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClientForCookies(cookieStore, "route-handler");

  const destination = await completeGoogleSignIn({
    auth: supabase.auth,
    cookies: cookieStore,
    appOrigin,
    callbackUrl: request.nextUrl,
    repositories,
    logger,
  });

  // `destination` is always a sanitized origin-relative path.
  const response = NextResponse.redirect(new URL(destination, appOrigin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
