import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { fileURLToPath } from "url";
import sharp from "sharp";

import { Users } from "./collections/Users";
import { ApiKeys } from "./collections/ApiKeys";
import { Media } from "./collections/Media";
import { Posts } from "./collections/Posts";
import { Pages } from "./collections/Pages";
import { Categories } from "./collections/Categories";
import { SiteSettings } from "./globals/SiteSettings";
import { contentCliPlugin } from "../../src/plugin/index";
import { payloadPagesPlugin } from "@jhb.software/payload-pages-plugin";
import { examplePluginEndpoints } from "./endpoints/example-plugin";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    autoLogin: {
      email: "admin@example.com",
      password: "admin123",
    },
  },
  collections: [Users, ApiKeys, Media, Posts, Pages, Categories],
  globals: [SiteSettings],
  localization: {
    locales: [
      { label: "English", code: "en" },
      { label: "German", code: "de" },
    ],
    defaultLocale: "en",
    fallback: true,
  },
  editor: lexicalEditor(),
  secret:
    process.env.PAYLOAD_SECRET ||
    "payload-content-cli-dev-secret-key-change-me",
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
  db: mongooseAdapter({
    url:
      process.env.DATABASE_URL ||
      "mongodb://localhost:27017/payload-content-cli",
  }),
  sharp,
  endpoints: examplePluginEndpoints,
  plugins: [
    contentCliPlugin(),
    payloadPagesPlugin({
      generatePageURL: ({ path }) =>
        path ? `http://localhost:3000${path}` : null,
    }),
  ],
});
