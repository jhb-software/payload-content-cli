import { afterEach, describe, expect, it, vi } from "vitest";
import { PayloadClient } from "../client.js";
import { SCHEMA_CONTRACT_VERSION } from "../schema-contract.js";

const client = () =>
  new PayloadClient({
    payloadUrl: "http://cms.test",
    apiKey: "key",
    authCollection: "users",
    outputDir: "content",
  });

/** A server whose schema endpoint answers `schema`, and whose documents answer 200. */
function serve(schema: Response) {
  const requested: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    requested.push(String(url));
    if (String(url).includes("/content-cli/schema")) return schema.clone();
    return Response.json({ id: "1", title: "Titel" });
  });
  return requested;
}

const schemaWith = (localization: unknown) =>
  Response.json({ version: SCHEMA_CONTRACT_VERSION, collections: {}, globals: {}, localization });

afterEach(() => vi.restoreAllMocks());

describe("locale check", () => {
  it("reads in a locale when the schema endpoint refuses the key", async () => {
    serve(Response.json({ error: "Unauthorized" }, { status: 401 }));

    const doc = await client().getDoc("posts", "1", { locale: "de" });

    expect(doc).toEqual({ id: "1", title: "Titel" });
  });

  it("asks a schema endpoint that refuses the key only once", async () => {
    const requested = serve(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const cms = client();

    await cms.getDoc("posts", "1", { locale: "de" });
    await cms.getDoc("posts", "2", { locale: "de" });

    expect(requested.filter((url) => url.includes("/content-cli/schema"))).toHaveLength(1);
  });

  it("refuses a locale on an app without localization", async () => {
    const requested = serve(schemaWith(null));

    await expect(client().getDoc("posts", "1", { locale: "de" })).rejects.toThrow(
      "This app has no locales",
    );
    expect(requested.some((url) => url.includes("/posts/1"))).toBe(false);
  });

  it("accepts * as all locales", async () => {
    serve(schemaWith({ locales: ["en", "de"], defaultLocale: "en" }));

    await expect(client().getDoc("posts", "1", { locale: "*" })).resolves.toMatchObject({
      id: "1",
    });
  });
});
