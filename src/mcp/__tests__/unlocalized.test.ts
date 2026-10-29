import type { Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpContentTools } from "../index.js";
import { boot, call, open, toolNamed } from "./payload.js";

let payload: Payload;

beforeAll(async () => {
  payload = await boot("mcp-unlocalized", {
    collections: [
      {
        slug: "trips",
        access: open,
        versions: { drafts: true },
        fields: [
          // Payload drops `localized` without localization.
          { name: "title", type: "text", localized: true },
          {
            name: "facts",
            type: "array",
            fields: [{ name: "label", type: "text", localized: true }],
          },
        ],
      },
    ],
  });
});

const tool = (name: string, args: Record<string, unknown>) =>
  call(payload, toolNamed(createMcpContentTools(), name), args);

describe("an app without localization", () => {
  it("refuses an update that leaves out rows, and writes one that keeps them", async () => {
    const trip = (await payload.create({
      collection: "trips",
      data: { title: "Safari", facts: [{ label: "Wildlife" }, { label: "Lodges" }] } as never,
    })) as unknown as { id: number; facts: { id: string; label: string }[] };
    const [wildlife, lodges] = trip.facts;

    const refused = await tool("update", {
      collection: "trips",
      id: trip.id,
      data: { facts: [{ id: lodges.id, label: "Camps" }] },
    });
    const written = await tool("update", {
      collection: "trips",
      id: trip.id,
      data: { title: "Big safari", facts: [wildlife, { id: lodges.id, label: "Camps" }] },
    });

    expect(refused.error).toContain(`facts (${wildlife.id})`);
    expect(written).toEqual({ id: trip.id, status: "draft" });
    const stored = await payload.findByID({ collection: "trips", id: trip.id, draft: true });
    expect(stored).toMatchObject({
      title: "Big safari",
      facts: [{ label: "Wildlife" }, { label: "Camps" }],
    });
  });

  it("refuses a locale instead of ignoring it", async () => {
    const trip = await payload.create({ collection: "trips", data: { title: "Safari" } as never });

    const read = await tool("find", { collection: "trips", id: trip.id, locale: "fr" });
    const written = await tool("update", {
      collection: "trips",
      id: trip.id,
      locale: "fr",
      data: { title: "Le safari" },
    });

    expect(read.error).toContain("no locales");
    expect(written.error).toContain("no locales");
    const stored = await payload.findByID({ collection: "trips", id: trip.id, draft: true });
    expect(stored).toMatchObject({ title: "Safari" });
  });

  it("reads normally when the app's resolveLocale picks a locale", async () => {
    const trip = await payload.create({ collection: "trips", data: { title: "Safari" } as never });

    const result = await call(
      payload,
      toolNamed(createMcpContentTools({ resolveLocale: () => "en" }), "find"),
      { collection: "trips", id: trip.id },
    );

    expect(result).toMatchObject({ title: "Safari" });
  });

  it("marks no rows as shared across locales", async () => {
    const tree = await tool("getEntitySchema", { collection: "trips" });

    expect(tree).toBe(
      ["trips (collection)", "  title: text", "  facts[]: array", "    label: text"].join("\n"),
    );
  });
});
