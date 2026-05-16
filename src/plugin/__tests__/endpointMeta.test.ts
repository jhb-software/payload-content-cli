import { describe, it, expect } from "vitest";
import { extractEndpointMeta, contentCliPlugin } from "../index.js";

describe("extractEndpointMeta", () => {
  it("returns empty object when custom is undefined", () => {
    expect(extractEndpointMeta(undefined)).toEqual({});
  });

  it("returns empty object when custom is null", () => {
    expect(extractEndpointMeta(null)).toEqual({});
  });

  it("returns empty object when custom is a non-object", () => {
    expect(extractEndpointMeta("string")).toEqual({});
    expect(extractEndpointMeta(42)).toEqual({});
  });

  it("returns empty object when custom has no recognized keys", () => {
    expect(extractEndpointMeta({ unrelated: true })).toEqual({});
  });

  it("extracts description", () => {
    expect(extractEndpointMeta({ description: "Get stats" })).toEqual({
      description: "Get stats",
    });
  });

  it("ignores non-string description", () => {
    expect(extractEndpointMeta({ description: 123 })).toEqual({});
  });

  it("extracts schema with query", () => {
    const custom = { schema: { query: { locale: "string" } } };
    expect(extractEndpointMeta(custom)).toEqual({
      schema: { query: { locale: "string" } },
    });
  });

  it("extracts schema with body", () => {
    const custom = { schema: { body: { title: "string" } } };
    expect(extractEndpointMeta(custom)).toEqual({
      schema: { body: { title: "string" } },
    });
  });

  it("extracts schema with response", () => {
    const custom = { schema: { response: { count: "number" } } };
    expect(extractEndpointMeta(custom)).toEqual({
      schema: { response: { count: "number" } },
    });
  });

  it("extracts all schema fields together", () => {
    const custom = {
      description: "Publish drafts",
      schema: {
        query: { locale: "string" },
        body: { dryRun: "boolean" },
        response: { published: "number" },
      },
    };
    expect(extractEndpointMeta(custom)).toEqual(custom);
  });

  it("ignores non-object schema", () => {
    expect(extractEndpointMeta({ schema: "not-object" })).toEqual({});
  });

  it("ignores non-object schema sub-fields", () => {
    expect(extractEndpointMeta({ schema: { query: "bad", body: 42 } })).toEqual({});
  });

  it("ignores extra keys in custom", () => {
    const result = extractEndpointMeta({
      description: "Test",
      somethingElse: true,
    });
    expect(result).toEqual({ description: "Test" });
    expect(result).not.toHaveProperty("somethingElse");
  });
});

describe("contentCliPlugin endpoint metadata", () => {
  it("resolves full paths and captures custom metadata", async () => {
    const plugin = contentCliPlugin();
    const config = {
      endpoints: [
        {
          path: "/stats",
          method: "get",
          custom: {
            description: "Get stats",
            schema: { response: { count: "number" } },
          },
          handler: () => {},
        },
      ],
      collections: [
        {
          slug: "posts",
          fields: [],
          endpoints: [
            {
              path: "/publish",
              method: "post",
              custom: {
                description: "Publish a post",
                schema: {
                  query: { locale: "string" },
                  body: { status: "string" },
                  response: { id: "string" },
                },
              },
              handler: () => {},
            },
          ],
        },
      ],
      globals: [
        {
          slug: "settings",
          fields: [],
          endpoints: [
            {
              path: "/refresh",
              method: "post",
              handler: () => {},
              // no custom — should still work
            },
          ],
        },
      ],
    };

    const result = plugin(config);
    const schemaEndpoint = result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");

    const mockReq = {
      user: { id: 1 },
      payload: {
        config: {
          collections: config.collections,
          globals: config.globals,
        },
      },
    };

    const response = await schemaEndpoint.handler(mockReq);
    const body = await response.json();

    // Root endpoint — resolved path with metadata
    expect(body.endpoints).toContainEqual({
      path: "/api/stats",
      method: "get",
      description: "Get stats",
      schema: { response: { count: "number" } },
    });

    // Collection endpoint — resolved path includes slug, full schema
    expect(body.endpoints).toContainEqual({
      path: "/api/posts/publish",
      method: "post",
      description: "Publish a post",
      schema: {
        query: { locale: "string" },
        body: { status: "string" },
        response: { id: "string" },
      },
    });

    // Global endpoint — resolved path, no custom metadata
    expect(body.endpoints).toContainEqual({
      path: "/api/globals/settings/refresh",
      method: "post",
    });
  });

  it("returns 401 when the request has no authenticated user", async () => {
    const plugin = contentCliPlugin();
    const result = plugin({ endpoints: [] });
    const schemaEndpoint = result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");

    const response = await schemaEndpoint.handler({ user: null, payload: {} });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("uses custom access hook when provided", async () => {
    const plugin = contentCliPlugin({
      access: (req: any) => req.headers?.get("x-secret") === "open-sesame",
    });
    const result = plugin({ endpoints: [] });
    const schemaEndpoint = result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");

    // denied — wrong secret
    const denied = await schemaEndpoint.handler({
      user: null,
      headers: new Headers({ "x-secret": "wrong" }),
      payload: {},
    });
    expect(denied.status).toBe(401);

    // allowed — correct secret (no user required)
    const allowed = await schemaEndpoint.handler({
      user: null,
      headers: new Headers({ "x-secret": "open-sesame" }),
      payload: {
        config: { collections: [], globals: [] },
      },
    });
    expect(allowed.status).toBe(200);
  });

  it("custom access hook receives the request object", async () => {
    let capturedReq: any;
    const plugin = contentCliPlugin({
      access: (req: any) => {
        capturedReq = req;
        return true;
      },
    });
    const result = plugin({ endpoints: [] });
    const schemaEndpoint = result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");

    const mockReq = {
      user: null,
      payload: { config: { collections: [], globals: [] } },
    };
    await schemaEndpoint.handler(mockReq);
    expect(capturedReq).toBe(mockReq);
  });

  it("handles endpoints with no custom property", () => {
    const plugin = contentCliPlugin();
    const result = plugin({
      endpoints: [{ path: "/plain", method: "get", handler: () => {} }],
    });

    // Should not throw, endpoints array should have original + /content-cli/schema
    expect(result.endpoints).toHaveLength(2);
  });
});

describe("contentCliPlugin per-entity read access", () => {
  function getSchemaEndpoint(config: any) {
    const plugin = contentCliPlugin();
    const result = plugin(config);
    return result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");
  }

  it("omits collections whose access.read returns false", async () => {
    const config = {
      endpoints: [],
      collections: [
        { slug: "posts", fields: [], access: { read: () => true } },
        { slug: "secrets", fields: [], access: { read: () => false } },
      ],
      globals: [],
    };
    const endpoint = getSchemaEndpoint(config);

    const body = await (
      await endpoint.handler({
        user: { id: 1 },
        payload: {
          config: { collections: config.collections, globals: config.globals },
        },
      })
    ).json();

    expect(Object.keys(body.collections)).toEqual(["posts"]);
    expect(body.collections.secrets).toBeUndefined();
  });

  it("omits globals whose access.read returns false", async () => {
    const config = {
      endpoints: [],
      collections: [],
      globals: [
        { slug: "settings", fields: [], access: { read: () => true } },
        { slug: "hidden", fields: [], access: { read: () => false } },
      ],
    };
    const endpoint = getSchemaEndpoint(config);

    const body = await (
      await endpoint.handler({
        user: { id: 1 },
        payload: {
          config: { collections: config.collections, globals: config.globals },
        },
      })
    ).json();

    expect(Object.keys(body.globals)).toEqual(["settings"]);
    expect(body.globals.hidden).toBeUndefined();
  });

  it("treats a where-clause return value as access", async () => {
    const config = {
      endpoints: [],
      collections: [
        {
          slug: "posts",
          fields: [],
          access: { read: () => ({ author: { equals: 1 } }) },
        },
      ],
      globals: [],
    };
    const endpoint = getSchemaEndpoint(config);

    const body = await (
      await endpoint.handler({
        user: { id: 1 },
        payload: {
          config: { collections: config.collections, globals: config.globals },
        },
      })
    ).json();

    expect(body.collections.posts).toBeDefined();
  });

  it("defaults to req.user truthy when access.read is not defined", async () => {
    const config = {
      endpoints: [],
      collections: [{ slug: "posts", fields: [] }],
      globals: [{ slug: "settings", fields: [] }],
    };
    const endpoint = getSchemaEndpoint(config);

    const body = await (
      await endpoint.handler({
        user: { id: 1 },
        payload: {
          config: { collections: config.collections, globals: config.globals },
        },
      })
    ).json();

    expect(body.collections.posts).toBeDefined();
    expect(body.globals.settings).toBeDefined();
  });

  it("filters out collection-scoped custom endpoints when collection is not readable", async () => {
    const config = {
      endpoints: [
        {
          path: "/stats",
          method: "get",
          custom: { description: "Top-level" },
          handler: () => {},
        },
      ],
      collections: [
        {
          slug: "posts",
          fields: [],
          access: { read: () => true },
          endpoints: [{ path: "/publish", method: "post", handler: () => {} }],
        },
        {
          slug: "secrets",
          fields: [],
          access: { read: () => false },
          endpoints: [{ path: "/leak", method: "get", handler: () => {} }],
        },
      ],
      globals: [],
    };
    const endpoint = getSchemaEndpoint(config);

    const body = await (
      await endpoint.handler({
        user: { id: 1 },
        payload: {
          config: { collections: config.collections, globals: config.globals },
        },
      })
    ).json();

    const paths = body.endpoints.map((e: any) => e.path);
    expect(paths).toContain("/api/stats");
    expect(paths).toContain("/api/posts/publish");
    expect(paths).not.toContain("/api/secrets/leak");
  });

  it("filters out global-scoped custom endpoints when global is not readable", async () => {
    const config = {
      endpoints: [],
      collections: [],
      globals: [
        {
          slug: "settings",
          fields: [],
          access: { read: () => true },
          endpoints: [{ path: "/refresh", method: "post", handler: () => {} }],
        },
        {
          slug: "hidden",
          fields: [],
          access: { read: () => false },
          endpoints: [{ path: "/peek", method: "get", handler: () => {} }],
        },
      ],
    };
    const endpoint = getSchemaEndpoint(config);

    const body = await (
      await endpoint.handler({
        user: { id: 1 },
        payload: {
          config: { collections: config.collections, globals: config.globals },
        },
      })
    ).json();

    const paths = body.endpoints.map((e: any) => e.path);
    expect(paths).toContain("/api/globals/settings/refresh");
    expect(paths).not.toContain("/api/globals/hidden/peek");
  });

  it("passes req to entity access.read", async () => {
    let capturedArg: any;
    const config = {
      endpoints: [],
      collections: [
        {
          slug: "posts",
          fields: [],
          access: {
            read: (arg: any) => {
              capturedArg = arg;
              return true;
            },
          },
        },
      ],
      globals: [],
    };
    const endpoint = getSchemaEndpoint(config);

    const mockReq = {
      user: { id: 1 },
      payload: {
        config: { collections: config.collections, globals: config.globals },
      },
    };
    await endpoint.handler(mockReq);
    expect(capturedArg.req).toBe(mockReq);
  });

  it("denies access when access.read throws", async () => {
    const config = {
      endpoints: [],
      collections: [
        {
          slug: "broken",
          fields: [],
          access: {
            read: () => {
              throw new Error("boom");
            },
          },
        },
      ],
      globals: [],
    };
    const endpoint = getSchemaEndpoint(config);

    const body = await (
      await endpoint.handler({
        user: { id: 1 },
        payload: {
          config: { collections: config.collections, globals: config.globals },
        },
      })
    ).json();

    expect(body.collections.broken).toBeUndefined();
  });
});
