import { NextResponse } from "next/server";

import {
  checkDatabaseReadiness,
  type ReadinessResult,
} from "../../../../infrastructure/database-health";
import { logger } from "../../../../infrastructure/logger";
import {
  headersWithRequestId,
  requestIdFromHeaders,
} from "../../../../infrastructure/request-id";

export const dynamic = "force-dynamic";

type ReadinessCheck = () => Promise<ReadinessResult>;

export function createReadyHandler(check: ReadinessCheck = checkDatabaseReadiness) {
  return async function readyHandler(request: Request): Promise<NextResponse> {
    const requestId = requestIdFromHeaders(request.headers);

    try {
      const result = await check();
      if (result.ready) {
        return NextResponse.json(
          { status: "ready" },
          { status: 200, headers: headersWithRequestId(requestId) },
        );
      }

      logger.warn("health.ready.failed", { requestId, reason: result.reason });
      return unavailable(requestId);
    } catch (error) {
      logger.error("health.ready.failed", { requestId, error });
      return unavailable(requestId);
    }
  };
}

export const GET = createReadyHandler();

function unavailable(requestId: string): NextResponse {
  return NextResponse.json(
    {
      status: "unavailable",
      message: "서비스 준비 상태를 확인할 수 없습니다.",
      requestId,
    },
    { status: 503, headers: headersWithRequestId(requestId) },
  );
}
