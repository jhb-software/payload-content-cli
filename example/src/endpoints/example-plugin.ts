import type { Endpoint } from "payload";
import type { EndpointCustom } from "../../../src/plugin/index";

/**
 * Example custom endpoints that simulate what a Payload plugin might register.
 * Used to test the `request` command with non-standard API routes.
 */
export const examplePluginEndpoints: Endpoint[] = [
  {
    path: "/example-plugin/stats",
    method: "get",
    custom: {
      description: "Get document counts for all content collections",
      schema: {
        response: {
          posts: "number",
          pages: "number",
          media: "number",
          generatedAt: "string (ISO date)",
        },
      },
    } satisfies EndpointCustom,
    handler: async (req) => {
      const posts = await req.payload.count({ collection: "posts" });
      const pages = await req.payload.count({ collection: "pages" });
      const media = await req.payload.count({ collection: "media" });

      return Response.json({
        posts: posts.totalDocs,
        pages: pages.totalDocs,
        media: media.totalDocs,
        generatedAt: new Date().toISOString(),
      });
    },
  },
  {
    path: "/example-plugin/publish-all",
    method: "post",
    custom: {
      description: "Publish all draft posts",
      schema: {
        response: { message: "string", published: "{ id, title }[]" },
      },
    } satisfies EndpointCustom,
    handler: async (req) => {
      const drafts = await req.payload.find({
        collection: "posts",
        where: { status: { equals: "draft" } },
      });

      const updated = [];
      for (const doc of drafts.docs) {
        await req.payload.update({
          collection: "posts",
          id: doc.id,
          data: {
            status: "published",
            publishedAt: new Date().toISOString(),
          } as any,
        });
        updated.push({ id: doc.id, title: doc.title });
      }

      return Response.json({
        message: `Published ${updated.length} draft(s).`,
        published: updated,
      });
    },
  },
];
