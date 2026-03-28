import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncAction, useAsyncActionWithResult } from "../useAsyncAction";

describe("useAsyncAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls reload after successful action", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncAction(action, { reload, setError })
    );

    await act(async () => {
      await result.current("arg1", "arg2");
    });

    expect(action).toHaveBeenCalledWith("arg1", "arg2");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(setError).not.toHaveBeenCalled();
  });

  it("calls setError on failure", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Action failed"));
    const reload = vi.fn().mockResolvedValue(undefined);
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncAction(action, { reload, setError })
    );

    await expect(
      act(async () => {
        await result.current();
      })
    ).rejects.toThrow("Action failed");

    expect(setError).toHaveBeenCalledWith("Action failed");
    expect(reload).not.toHaveBeenCalled();
  });

  it("rethrows error after setError", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Test error"));
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncAction(action, { setError })
    );

    await expect(
      act(async () => {
        await result.current();
      })
    ).rejects.toThrow("Test error");

    expect(setError).toHaveBeenCalledWith("Test error");
  });

  it("works without options", async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAsyncAction(action, {})
    );

    await act(async () => {
      await result.current("test");
    });

    expect(action).toHaveBeenCalledWith("test");
  });

  it("works without reload", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncAction(action, { setError })
    );

    await act(async () => {
      await result.current();
    });

    expect(action).toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("handles string errors", async () => {
    const action = vi.fn().mockRejectedValue("String error message");
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncAction(action, { setError })
    );

    await expect(
      act(async () => {
        await result.current();
      })
    ).rejects.toThrow();

    expect(setError).toHaveBeenCalledWith("String error message");
  });

  it("handles non-Error objects", async () => {
    const action = vi.fn().mockRejectedValue({ code: 500 });
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncAction(action, { setError })
    );

    await expect(
      act(async () => {
        await result.current();
      })
    ).rejects.toThrow();

    expect(setError).toHaveBeenCalledWith("[object Object]");
  });
});

describe("useAsyncActionWithResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns result from action", async () => {
    const action = vi.fn().mockResolvedValue("result value");
    const reload = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAsyncActionWithResult(action, { reload })
    );

    let returnValue: string | undefined;
    await act(async () => {
      returnValue = await result.current();
    });

    expect(returnValue).toBe("result value");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("clears error before action", async () => {
    const action = vi.fn().mockResolvedValue("ok");
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncActionWithResult(action, { setError })
    );

    await act(async () => {
      await result.current();
    });

    expect(setError).toHaveBeenCalledWith(null);
  });

  it("skips reload when reloadAfter is false", async () => {
    const action = vi.fn().mockResolvedValue("data");
    const reload = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAsyncActionWithResult(action, { reload, reloadAfter: false })
    );

    await act(async () => {
      await result.current();
    });

    expect(reload).not.toHaveBeenCalled();
  });

  it("calls setError on failure and rethrows", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Failed"));
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncActionWithResult(action, { setError })
    );

    await expect(
      act(async () => {
        await result.current();
      })
    ).rejects.toThrow("Failed");

    expect(setError).toHaveBeenNthCalledWith(1, null);
    expect(setError).toHaveBeenNthCalledWith(2, "Failed");
  });

  it("does not call reload on failure", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Error"));
    const reload = vi.fn().mockResolvedValue(undefined);
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncActionWithResult(action, { reload, setError })
    );

    await expect(
      act(async () => {
        await result.current();
      })
    ).rejects.toThrow();

    expect(reload).not.toHaveBeenCalled();
  });

  it("passes arguments to action", async () => {
    const action = vi.fn().mockResolvedValue(42);

    const { result } = renderHook(() =>
      useAsyncActionWithResult(action, {})
    );

    await act(async () => {
      await result.current("a", "b", "c");
    });

    expect(action).toHaveBeenCalledWith("a", "b", "c");
  });
});
