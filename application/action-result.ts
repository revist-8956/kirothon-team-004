import { logger } from "../infrastructure/logger";

export type ActionErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OAUTH_ERROR"
  | "INTERNAL_ERROR";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
      requestId: string;
    };

const DEFAULT_MESSAGES: Record<ActionErrorCode, string> = {
  VALIDATION_ERROR: "입력한 내용을 확인해 주세요.",
  UNAUTHENTICATED: "로그인이 필요합니다.",
  FORBIDDEN: "요청한 작업을 수행할 권한이 없습니다.",
  NOT_FOUND: "요청한 정보를 찾을 수 없습니다.",
  CONFLICT: "이미 처리되었거나 현재 상태와 충돌합니다.",
  OAUTH_ERROR: "Google 로그인에 실패했습니다. 다시 시도해 주세요.",
  INTERNAL_ERROR: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

export class ApplicationError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    options?: {
      message?: string;
      fieldErrors?: Record<string, string[]>;
      cause?: unknown;
    },
  ) {
    super(options?.message ?? DEFAULT_MESSAGES[code], { cause: options?.cause });
    this.name = "ApplicationError";
    this.fieldErrors = options?.fieldErrors;
  }

  readonly fieldErrors?: Record<string, string[]>;
}

export function actionSuccess<T>(data: T, message?: string): ActionResult<T> {
  return message === undefined ? { ok: true, data } : { ok: true, data, message };
}

export function mapActionError(error: unknown, requestId: string): ActionResult<never> {
  if (error instanceof ApplicationError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      requestId,
    };
  }

  const prismaCode = getErrorCode(error);
  if (prismaCode === "P2002") {
    return failure("CONFLICT", requestId);
  }
  if (prismaCode === "P2025") {
    return failure("NOT_FOUND", requestId);
  }

  logger.error("action.failed", { requestId, error });
  return failure("INTERNAL_ERROR", requestId);
}

function failure(code: ActionErrorCode, requestId: string): ActionResult<never> {
  return { ok: false, code, message: DEFAULT_MESSAGES[code], requestId };
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}
