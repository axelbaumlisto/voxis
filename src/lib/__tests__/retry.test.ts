import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const result = await withRetry(fn, { delay: 1 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after all retries fail", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(withRetry(fn, { maxRetries: 3, delay: 1 })).rejects.toThrow(
      "always fails"
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects maxRetries option", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(withRetry(fn, { maxRetries: 5, delay: 1 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("calls onRetry callback on each retry", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const onRetry = vi.fn();

    await expect(
      withRetry(fn, { maxRetries: 3, delay: 1, onRetry })
    ).rejects.toThrow();

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
  });

  it("uses default options", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
  });

  it("handles non-Error throws", async () => {
    const fn = vi.fn().mockRejectedValue("string error");

    await expect(withRetry(fn, { maxRetries: 2, delay: 1 })).rejects.toBe(
      "string error"
    );
  });
});
