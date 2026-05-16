import { describe, it, expect, vi, beforeEach } from "vitest";
import { PayloadClient } from "../client.js";

function makeClient() {
  return new PayloadClient({
    payloadUrl: "http://localhost:3000",
    apiKey: "test-key",
    authCollection: "users",
    outputDir: "content",
  });
}

function mockRequest(client: PayloadClient, data: unknown) {
  vi.spyOn(
    client as unknown as { request: () => unknown },
    "request",
  ).mockResolvedValue(data);
}

describe("getAccess", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns collections and globals with read access", async () => {
    const client = makeClient();
    mockRequest(client, {
      collections: {
        posts: { read: true, fields: {} },
        pages: { read: true, fields: {} },
      },
      globals: {
        header: { read: true, fields: {} },
        footer: { read: true, fields: {} },
      },
    });

    const access = await client.getAccess();
    expect(access.collections).toEqual(["posts", "pages"]);
    expect(access.globals).toEqual(["header", "footer"]);
  });

  it("excludes collections where read is absent (auth-only access)", async () => {
    const client = makeClient();
    // Auth collections like users/api-keys appear with fields but no read: true
    mockRequest(client, {
      collections: {
        posts: { read: true, fields: {} },
        users: { fields: {} },
        "api-keys": { fields: {} },
      },
      globals: {
        header: { read: true, fields: {} },
      },
    });

    const access = await client.getAccess();
    expect(access.collections).toEqual(["posts"]);
    expect(access.globals).toEqual(["header"]);
  });

  it("excludes collections where read is explicitly false", async () => {
    const client = makeClient();
    mockRequest(client, {
      collections: {
        posts: { read: true, fields: {} },
        secret: { read: false, fields: {} },
      },
      globals: {
        header: { read: true, fields: {} },
        internal: { read: false, fields: {} },
      },
    });

    const access = await client.getAccess();
    expect(access.collections).toEqual(["posts"]);
    expect(access.globals).toEqual(["header"]);
  });

  it("filters out Payload internal collections", async () => {
    const client = makeClient();
    mockRequest(client, {
      collections: {
        posts: { read: true, fields: {} },
        "payload-locked-documents": { read: true, fields: {} },
        "payload-preferences": { read: true, fields: {} },
        "payload-migrations": { read: true, fields: {} },
      },
      globals: {},
    });

    const access = await client.getAccess();
    expect(access.collections).toEqual(["posts"]);
  });

  it("handles empty response", async () => {
    const client = makeClient();
    mockRequest(client, {});

    const access = await client.getAccess();
    expect(access.collections).toEqual([]);
    expect(access.globals).toEqual([]);
  });

  it("handles mixed access — real-world shape from Payload", async () => {
    const client = makeClient();
    // Real /api/access: auth collections have fields but no read: true,
    // content collections have read: true, globals have read: true
    mockRequest(client, {
      collections: {
        users: { fields: { sessions: { read: true } } },
        "api-keys": { fields: {} },
        pages: { read: true, fields: { title: { read: true } } },
        services: { read: true, fields: {} },
        images: { read: true, fields: { url: { read: true } } },
        redirects: { read: true, fields: {} },
        "payload-locked-documents": { fields: {} },
        "payload-preferences": { fields: {} },
      },
      globals: {
        header: { read: true, fields: { pages: { read: true } } },
        footer: { read: true, fields: { details: { read: true } } },
        labels: { read: true, fields: {} },
        "opening-hours": { read: true, fields: {} },
      },
    });

    const access = await client.getAccess();
    expect(access.collections).toEqual([
      "pages",
      "services",
      "images",
      "redirects",
    ]);
    expect(access.globals).toEqual([
      "header",
      "footer",
      "labels",
      "opening-hours",
    ]);
  });
});
