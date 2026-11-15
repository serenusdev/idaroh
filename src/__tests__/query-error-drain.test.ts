import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryError, throwQueryError } from "../lib/query-error";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// OPS-04: errors are logged with a correlation id and optionally forwarded to an
// alerting drain. The hook must be a no-op without OPS_ERROR_WEBHOOK_URL.
describe("OPS-04 — query error drain", () => {
  it("throws a QueryError carrying a correlation id", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPS_ERROR_WEBHOOK_URL", "");
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve({}));
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      throwQueryError("attendance.today", new Error("boom"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as QueryError).correlationId).toMatch(/^QRY-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the error to the configured drain without blocking the throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPS_ERROR_WEBHOOK_URL", "https://drain.example.test/hook");
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve({}));
    vi.stubGlobal("fetch", fetchMock);

    expect(() => throwQueryError("reports.queue", new Error("boom"))).toThrow(QueryError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://drain.example.test/hook");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(String(init.body));
    expect(payload.scope).toBe("reports.queue");
    expect(payload.correlationId).toMatch(/^QRY-/);
  });
});