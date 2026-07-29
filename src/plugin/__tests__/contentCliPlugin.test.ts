import { describe, it, expect } from "vitest";
import { contentCliPlugin } from "../index.js";
import { SCHEMA_CONTRACT_VERSION } from "../../schema-contract.js";

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

  it("stamps the schema response with the contract version", async () => {
    const plugin = contentCliPlugin();
    const result = plugin({ endpoints: [] });
    const schemaEndpoint = result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");

    const response = await schemaEndpoint.handler({
      user: { id: 1 },
      payload: { config: { collections: [], globals: [] } },
    });
    const body = await response.json();

    expect(body.version).toBe(SCHEMA_CONTRACT_VERSION);
  });

  it("still inlines block fields in the schema response", async () => {
    // The CLI resolves blocks offline (virtual-field stripping, _jsonschema.json),
    // so the endpoint keeps inlining even though the exported helpers reference.
    const plugin = contentCliPlugin();
    const result = plugin({ endpoints: [] });
    const schemaEndpoint = result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");

    const response = await schemaEndpoint.handler({
      user: { id: 1 },
      payload: {
        config: {
          collections: [
            {
              slug: "pages",
              fields: [
                {
                  name: "layout",
                  type: "blocks",
                  blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
                },
              ],
            },
          ],
          globals: [],
        },
      },
    });
    const body = await response.json();

    expect(body.collections.pages.fields).toEqual([
      {
        name: "layout",
        type: "blocks",
        blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
      },
    ]);
  });

  it("resolves endpoint paths against a custom routes.api prefix", async () => {
    const plugin = contentCliPlugin();
    const result = plugin({
      routes: { api: "/custom-api" },
      endpoints: [{ path: "/stats", method: "get", handler: () => {} }],
    });
    const schemaEndpoint = result.endpoints.find((ep: any) => ep.path === "/content-cli/schema");

    const response = await schemaEndpoint.handler({
      user: { id: 1 },
      payload: { config: { collections: [], globals: [] } },
    });
    const body = await response.json();

    expect(body.endpoints).toContainEqual({ path: "/custom-api/stats", method: "get" });
  });

  it("does not register the schema endpoint twice when applied twice", () => {
    const plugin = contentCliPlugin();
    const once = plugin({ endpoints: [] });
    const twice = plugin(once);

    const schemaEndpoints = twice.endpoints.filter((ep: any) => ep.path === "/content-cli/schema");
    expect(schemaEndpoints).toHaveLength(1);
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
