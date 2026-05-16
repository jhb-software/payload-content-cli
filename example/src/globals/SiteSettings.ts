import type { GlobalConfig } from "payload";

export const SiteSettings: GlobalConfig = {
  slug: "site-settings",
  fields: [
    {
      name: "siteName",
      type: "text",
      required: true,
      localized: true,
    },
    {
      name: "siteDescription",
      type: "textarea",
      localized: true,
    },
    {
      name: "navigation",
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
      ],
    },
  ],
};
