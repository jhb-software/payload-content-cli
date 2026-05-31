import { withPayload } from "@payloadcms/next/withPayload";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app imports the plugin from TS source (`../../src/plugin`), which uses
  // NodeNext `.js`-extension imports (e.g. `./schema.js` -> `schema.ts`). Turbopack
  // can't rewrite `.js`->`.ts` (vercel/next.js#82945), so the dev/build scripts pin
  // `--webpack` and this extensionAlias resolves those imports. Drop `--webpack` only
  // once Turbopack gains extensionAlias parity.
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ".cjs": [".cts", ".cjs"],
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };

    return webpackConfig;
  },
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
