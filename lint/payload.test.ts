import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import plugin from "./payload.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester().run(
  "explicit-override-access",
  plugin.rules["explicit-override-access"] as never,
  {
    valid: [
      { code: `await payload.find({ collection: "pages", overrideAccess: false, req })` },
      { code: `await req.payload.update({ collection: "pages", overrideAccess: true })` },
      {
        name: "the flag arrives in a spread of a local const",
        code: `
        const read = { depth: 0, overrideAccess: false, req };
        await req.payload.findByID({ collection: "pages", id, ...read });`,
      },
      {
        name: "the const is cast, and declared in an outer scope",
        filename: "fixture.ts",
        code: `
        const read = { overrideAccess: false } as const;
        async function load() { await payload.find({ collection: "pages", ...read }); }`,
      },
      {
        name: "a const spreads another const",
        code: `
        const base = { overrideAccess: false };
        const read = { ...base, depth: 0 };
        await payload.find({ collection: "pages", ...read });`,
      },
      {
        name: "a later literal decides over an unknown spread before it",
        code: `await payload.find({ ...options, overrideAccess: false });`,
      },
      { name: "auth takes no such option", code: `await payload.auth({ headers })` },
      { name: "not the Local API", code: `await payload.db.find({ collection: "pages" })` },
      { name: "not Payload", code: `items.find({ id })` },
    ],
    invalid: [
      { code: `await payload.find({ collection: "pages" })`, errors: [{ messageId: "missing" }] },
      {
        code: `await req.payload.updateGlobal({ slug: "nav", data })`,
        errors: [{ messageId: "missing" }],
      },
      {
        name: "a login takes the flag too",
        code: `await payload.login({ collection: "users", data })`,
        errors: [{ messageId: "missing" }],
      },
      {
        name: "a cast doesn't hide the call",
        filename: "fixture.ts",
        code: `async function load() { await (req.payload as Payload).find({ collection: "pages" }); }`,
        errors: [{ messageId: "missing" }],
      },
      {
        name: "a non-null assertion doesn't hide the call",
        filename: "fixture.ts",
        code: `await req.payload!.find({ collection: "pages" })`,
        errors: [{ messageId: "missing" }],
      },
      {
        name: "a spread that doesn't carry the flag",
        code: `
        const read = { depth: 0 };
        await payload.find({ collection: "pages", ...read });`,
        errors: [{ messageId: "missing" }],
      },
      {
        name: "a computed value, which is how the shared rows guard got it wrong",
        code: `await payload.find({ collection: "pages", overrideAccess: args.overrideAccess !== false })`,
        errors: [{ messageId: "notLiteral" }],
      },
      {
        name: "a computed value inside a spread",
        code: `
        const read = { overrideAccess: decide(args) };
        await payload.find({ collection: "pages", ...read });`,
        errors: [{ messageId: "notLiteral" }],
      },
      {
        name: "a spread of a parameter can't be judged",
        code: `async function load(options) { await payload.find({ ...options }); }`,
        errors: [{ messageId: "unseen" }],
      },
      {
        name: "a spread after the flag may overwrite it",
        code: `async function load(options) { await payload.find({ overrideAccess: false, ...options }); }`,
        errors: [{ messageId: "unseen" }],
      },
      {
        name: "a reassignable variable can't be judged",
        code: `
        let read = { overrideAccess: false };
        await payload.find({ collection: "pages", ...read });`,
        errors: [{ messageId: "unseen" }],
      },
      {
        name: "options that aren't an object literal",
        code: `async function load(options) { await payload.find(options); }`,
        errors: [{ messageId: "unseen" }],
      },
    ],
  },
);
