import { describe, it, expect, expectTypeOf } from "vitest";
import type { ApiError } from "./index";

describe("shared exports", () => {
  it("ApiError interface has the expected shape", () => {
    const err: ApiError = { error: "NOT_FOUND", message: "Resource not found" };
    expect(err.error).toBe("NOT_FOUND");
    expect(err.message).toBe("Resource not found");
  });

  it("ApiError type has correct fields", () => {
    expectTypeOf<ApiError>().toHaveProperty("error");
    expectTypeOf<ApiError>().toHaveProperty("message");
    expectTypeOf<ApiError["error"]>().toBeString();
    expectTypeOf<ApiError["message"]>().toBeString();
  });
});
