import type { PageCollectionConfig } from "@jhb.software/payload-pages-plugin";
import {
  BlocksFeature,
  HeadingFeature,
  LinkFeature,
  lexicalEditor,
} from "@payloadcms/richtext-lexical";

export const Posts: PageCollectionConfig = {
  slug: "posts",
  admin: {
    useAsTitle: "title",
  },
  versions: {
    drafts: true,
  },
  page: {
    parent: { collection: "pages", name: "parent", sharedDocument: true },
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true,
      localized: true,
    },
    {
      name: "content",
      type: "richText",
      localized: true,
      editor: lexicalEditor({
        features: ({ defaultFeatures }) => [
          ...defaultFeatures,
          HeadingFeature({ enabledHeadingSizes: ["h2", "h3"] }),
          BlocksFeature({
            blocks: [
              {
                slug: "callout",
                fields: [
                  { name: "text", type: "text", required: true },
                  {
                    name: "variant",
                    type: "select",
                    options: ["info", "warning"],
                  },
                ],
              },
            ],
          }),
          LinkFeature({ enabledCollections: ["pages", "posts"] }),
        ],
      }),
    },
    {
      name: "excerpt",
      type: "textarea",
      localized: true,
    },
    {
      name: "featuredImage",
      type: "upload",
      relationTo: "media",
    },
    {
      name: "status",
      type: "select",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
      defaultValue: "draft",
    },
    {
      name: "publishedAt",
      type: "date",
    },
    {
      name: "author",
      type: "relationship",
      relationTo: "users",
    },
    {
      name: "categories",
      type: "relationship",
      relationTo: "categories",
      hasMany: true,
    },
    {
      name: "relatedPosts",
      type: "relationship",
      relationTo: "posts",
      hasMany: true,
    },
    {
      name: "tags",
      type: "array",
      fields: [
        {
          name: "tag",
          type: "text",
        },
      ],
    },
    {
      name: "meta",
      type: "group",
      fields: [
        {
          name: "title",
          type: "text",
        },
        {
          name: "description",
          type: "textarea",
        },
      ],
    },
  ],
};
