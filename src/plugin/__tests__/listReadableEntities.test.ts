import { describe, it, expect, vi } from "vitest";
import { listReadableEntities } from "../index.js";

/** Build a mock PayloadRequest carrying a config and an optional user. */
function mockReq(
  config: { collections?: any[]; globals?: any[]; localization?: any },
  user: any = { id: 1 },
) {
  return {
    user,
    payload: {
      config: {
        collections: config.collections ?? [],
        globals: config.globals ?? [],
        localization: config.localization,
      },
    },
  };
}

describe("listReadableEntities", () => {
  it("returns readable collections and globals as bare slugs", async () => {
    const req = mockReq({
      collections: [
        { slug: "posts", fields: [] },
        { slug: "pages", fields: [] },
      ],
      globals: [{ slug: "settings", fields: [] }],
    });

    const result = await listReadableEntities({ req });

    expect(result.collections).toEqual(["posts", "pages"]);
    expect(result.globals).toEqual(["settings"]);
  });

  it("omits collections and globals whose access.read returns false", async () => {
    const req = mockReq({
      collections: [
        { slug: "posts", fields: [], access: { read: () => true } },
        { slug: "secrets", fields: [], access: { read: () => false } },
      ],
      globals: [
        { slug: "settings", fields: [], access: { read: () => true } },
        { slug: "hidden", fields: [], access: { read: () => false } },
      ],
    });

    const result = await listReadableEntities({ req });

    expect(result.collections).toEqual(["posts"]);
    expect(result.globals).toEqual(["settings"]);
  });

  it("includes an entity whose access.read returns a where clause (lenient, matches getEntitySchema)", async () => {
    const req = mockReq({
      collections: [
        { slug: "posts", fields: [], access: { read: () => ({ author: { equals: 1 } }) } },
      ],
    });

    const result = await listReadableEntities({ req });
    expect(result.collections).toEqual(["posts"]);
  });

  it("denies access when access.read is undefined and there is no user", async () => {
    const req = mockReq(
      { collections: [{ slug: "posts", fields: [] }], globals: [{ slug: "settings", fields: [] }] },
      null,
    );

    const result = await listReadableEntities({ req });
    expect(result.collections).toEqual([]);
    expect(result.globals).toEqual([]);
  });

  it("maps localization locales (strings and objects) to codes, with the default locale", async () => {
    const req = mockReq({
      localization: {
        locales: ["en", { code: "de", label: "Deutsch" }],
        defaultLocale: "en",
      },
    });

    const result = await listReadableEntities({ req });
    expect(result.localization).toEqual({ locales: ["en", "de"], defaultLocale: "en" });
  });

  it("returns null localization when the config has none", async () => {
    const req = mockReq({ collections: [{ slug: "posts", fields: [] }] });

    const result = await listReadableEntities({ req });
    expect(result.localization).toBeNull();
  });

  it("warns naming the entity when its access.read throws, and treats it as denied", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const req = mockReq({
        collections: [
          { slug: "posts", fields: [], access: { read: () => true } },
          {
            slug: "broken-collection",
            fields: [],
            access: {
              read: () => {
                throw new Error("boom");
              },
            },
          },
        ],
      });

      const result = await listReadableEntities({ req });
      expect(result.collections).toEqual(["posts"]);
      const messages = warn.mock.calls.map((call) => call.join(" "));
      expect(messages.some((m) => m.includes("broken-collection") && m.includes("boom"))).toBe(
        true,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("passes req to the entity's access.read", async () => {
    let capturedArg: any;
    const req = mockReq({
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
    });

    await listReadableEntities({ req });
    expect(capturedArg.req).toBe(req);
  });
});
