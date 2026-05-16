import type { PageCollectionConfig } from "@jhb.software/payload-pages-plugin";

export const Pages: PageCollectionConfig = {
  slug: "pages",
  admin: {
    useAsTitle: "title",
  },
  page: {
    parent: { collection: "pages", name: "parent" },
    isRootCollection: true,
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true,
      localized: true,
    },
    {
      name: "layout",
      type: "blocks",
      blocks: [
        {
          slug: "hero",
          fields: [
            {
              name: "heading",
              type: "text",
              required: true,
            },
            {
              name: "subheading",
              type: "textarea",
            },
            {
              name: "image",
              type: "upload",
              relationTo: "media",
            },
            {
              name: "ctaLabel",
              type: "text",
            },
            {
              name: "ctaLink",
              type: "text",
            },
          ],
        },
        {
          slug: "content",
          fields: [
            {
              name: "richText",
              type: "richText",
            },
          ],
        },
        {
          slug: "cta",
          fields: [
            {
              name: "heading",
              type: "text",
              required: true,
            },
            {
              name: "description",
              type: "textarea",
            },
            {
              name: "links",
              type: "array",
              fields: [
                {
                  name: "label",
                  type: "text",
                  required: true,
                },
                {
                  name: "url",
                  type: "text",
                  required: true,
                },
                {
                  name: "style",
                  type: "select",
                  options: [
                    { label: "Primary", value: "primary" },
                    { label: "Secondary", value: "secondary" },
                  ],
                  defaultValue: "primary",
                },
              ],
            },
          ],
        },
        {
          slug: "gallery",
          fields: [
            {
              name: "heading",
              type: "text",
            },
            {
              name: "images",
              type: "upload",
              relationTo: "media",
              hasMany: true,
              required: true,
            },
          ],
        },
        {
          slug: "cardGrid",
          fields: [
            {
              name: "heading",
              type: "text",
            },
            {
              name: "cards",
              type: "array",
              fields: [
                {
                  name: "title",
                  type: "text",
                  required: true,
                },
                {
                  name: "description",
                  type: "textarea",
                },
                {
                  name: "link",
                  type: "text",
                },
              ],
            },
          ],
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
