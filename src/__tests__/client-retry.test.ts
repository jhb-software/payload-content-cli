import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PayloadClient } from "../client.js";

const config = {
  payloadUrl: "http://localhost:9",
  apiKey: "key",
  authCollection: "api-keys",
  outputDir: "content",
};

function networkError(code: string): Error {
  const err = new TypeError("fetch failed");
  (err as Error & { cause?: unknown }).cause = { code };
  return err;
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PayloadClient retry behavior", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a GET after a mid-flight network error", async () => {
    fetchMock
      .mockRejectedValueOnce(networkError("ECONNRESET"))
      .mockResolvedValueOnce(okResponse({ docs: [], totalDocs: 0, hasNextPage: false }));

    const client = new PayloadClient(config);
    const result = await client.getCollectionDocs("posts");

    expect(result.totalDocs).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a POST after a mid-flight network error (may have been applied)", async () => {
    fetchMock.mockRejectedValue(networkError("ECONNRESET"));

    const client = new PayloadClient(config);
    await expect(client.createDoc("posts", { title: "x" })).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a POST when the connection was never established", async () => {
    fetchMock
      .mockRejectedValueOnce(networkError("ECONNREFUSED"))
      .mockResolvedValueOnce(okResponse({ doc: { id: "1" } }));

    const client = new PayloadClient(config);
    const doc = await client.createDoc("posts", { title: "x" });

    expect(doc.id).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a POST on a 500 response (may have been applied server-side)", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));

    const client = new PayloadClient(config);
    await expect(client.createDoc("posts", { title: "x" })).rejects.toThrow(/500/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a GET on a 500 response", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(okResponse({ docs: [], totalDocs: 3, hasNextPage: false }));

    const client = new PayloadClient(config);
    const result = await client.getCollectionDocs("posts");

    expect(result.totalDocs).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a POST on 429 (rate limited requests were not executed)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(okResponse({ doc: { id: "1" } }));

    const client = new PayloadClient(config);
    const doc = await client.createDoc("posts", { title: "x" });

    expect(doc.id).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
