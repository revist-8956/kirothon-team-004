import { NextResponse } from "next/server";

import { headersWithRequestId, requestIdFromHeaders } from "../../../../infrastructure/request-id";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  return NextResponse.json(
    { status: "ok" },
    { status: 200, headers: headersWithRequestId(requestId) },
  );
}
