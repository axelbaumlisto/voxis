import { describe, expect, it, vi } from "vitest";
import * as nativeOverlay from "../../e2e/helpers/nativeOverlay";

describe("native overlay capture retry", () => {
  it("retries capture with a fresh window id after screencapture failure", async () => {
    const waitForWindowId = vi
      .fn()
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(202);
    const captureOverlayRegion = vi
      .fn()
      .mockRejectedValueOnce(new Error("could not create image from window"))
      .mockResolvedValueOnce({
        path: "/tmp/final.png",
        fileSize: 123,
        sha256: "abc",
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const image = await (nativeOverlay as any).captureOverlayWindowForPid(777, "/tmp/final.png", {
      retries: 2,
      retryDelayMs: 5,
      waitForWindowId,
      captureOverlayRegion,
      sleep,
    });

    expect(waitForWindowId).toHaveBeenCalledTimes(2);
    expect(captureOverlayRegion).toHaveBeenNthCalledWith(1, 101, "/tmp/final.png");
    expect(captureOverlayRegion).toHaveBeenNthCalledWith(2, 202, "/tmp/final.png");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(image).toEqual({
      path: "/tmp/final.png",
      fileSize: 123,
      sha256: "abc",
    });
  });

  it("throws the last capture error after exhausting retries", async () => {
    const waitForWindowId = vi
      .fn()
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(202);
    const captureError = new Error("could not create image from window");
    const captureOverlayRegion = vi.fn().mockRejectedValue(captureError);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      (nativeOverlay as any).captureOverlayWindowForPid(777, "/tmp/final.png", {
        retries: 2,
        retryDelayMs: 5,
        waitForWindowId,
        captureOverlayRegion,
        sleep,
      }),
    ).rejects.toThrow("could not create image from window");

    expect(waitForWindowId).toHaveBeenCalledTimes(2);
    expect(captureOverlayRegion).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
