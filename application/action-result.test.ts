import { describe, expect, it } from "vitest";

import {
  actionSuccess,
  ApplicationError,
  mapActionError,
} from "./action-result";

describe("ActionResult helpers", () => {
  const requestId = "018f47ca-4f65-7c68-8a50-0ab7cc525a11";

  it("returns typed success data", () => {
    expect(actionSuccess({ id: "group-1" }, "저장되었습니다.")).toEqual({
      ok: true,
      data: { id: "group-1" },
      message: "저장되었습니다.",
    });
  });

  it("maps expected application errors with field details", () => {
    const result = mapActionError(
      new ApplicationError("VALIDATION_ERROR", {
        fieldErrors: { email: ["유효한 이메일 주소를 입력해 주세요."] },
      }),
      requestId,
    );

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "입력한 내용을 확인해 주세요.",
      fieldErrors: { email: ["유효한 이메일 주소를 입력해 주세요."] },
      requestId,
    });
  });

  it("maps database conflicts without exposing the original database error", () => {
    const databaseMessage = "duplicate key violates users_email_key for private@example.com";
    const result = mapActionError({ code: "P2002", message: databaseMessage }, requestId);

    expect(result).toMatchObject({ ok: false, code: "CONFLICT", requestId });
    expect(JSON.stringify(result)).not.toContain(databaseMessage);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });

  it("maps unknown failures to a stable generic response", () => {
    const secret = "postgresql://admin:secret@db.example.com/app";
    const result = mapActionError(new Error(secret), requestId);

    expect(result).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
