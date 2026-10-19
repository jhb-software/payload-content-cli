---
title: "Upstream issue draft: id-less rows in a non-localized array silently drop other locales' translations"
type: upstream-issue
status: draft
---

# Draft issue for `payloadcms/payload`

Not filed. For the author to review and file.

---

**Title:** Writing a non-localized array/blocks field without row ids silently deletes the other locales' translations

### Describe the bug

A non-localized `array` or `blocks` field with localized sub-fields stores one set of rows for every locale; each locale's values of the localized sub-fields belong to a row's `id`. When an update sends the rows without their `id`, Payload treats every row as new: `getExistingRowDoc` (`fields/hooks/beforeChange/getExistingRowDoc.ts`) matches incoming rows to stored ones by `id` only and otherwise returns `{}`, and `baseIDField` gives each id-less row a fresh ObjectId during the beforeValidate traversal. The old rows are deleted together with every other locale's translation of them.

The locale being written comes out as intended, so the write looks successful. The loss shows up later, in another locale, and usually goes unnoticed.

The admin panel never hits this, because it mints an id for every new row on the client. It is easy to hit from the REST/Local API and especially from AI agents (e.g. via `@payloadcms/plugin-mcp`), which read a document in one locale and write the array back with only the changed values.

### To reproduce

```ts
// localization: { locales: ['en', 'de'], defaultLocale: 'en' }
// fields: [{ name: 'extras', type: 'array', fields: [{ name: 'title', type: 'text', localized: true }] }]

const doc = await payload.create({ collection: 'hotels', locale: 'en', data: { extras: [{ title: 'Cuisine' }] } })
await payload.update({ collection: 'hotels', id: doc.id, locale: 'de', data: { extras: [{ id: doc.extras[0].id, title: 'Kulinarik' }] } })

// An English edit without the row id:
await payload.update({ collection: 'hotels', id: doc.id, locale: 'en', data: { extras: [{ title: 'Food' }] } })

const de = await payload.findByID({ collection: 'hotels', id: doc.id, locale: 'de', fallbackLocale: false })
// de.extras[0].title is undefined: "Kulinarik" is gone.
```

### Expected behavior

One of:

1. Refuse the write (a `ValidationError` on the field) when rows exist, the field is shared across locales (not localized, with localized descendants), and every incoming row lacks an `id`. A request-context opt-out would cover intentional replacements. Sending at least one id, or fresh ids as the admin panel does, would keep passing.
2. Or, at least, document the behaviour prominently on the array and blocks field pages and in the localization docs, and log a warning.

We run (1) as a `beforeOperation` hook in [`@jhb.software/payload-content-cli`](https://github.com/jhb-software/payload-content-cli) (`preserveSharedRowsPlugin`). It has to be `beforeOperation`, because the id backfill runs before every later document hook, so a `beforeChange` check sees ids on every row and can never fire. A core check could run before the backfill without the extra read our hook needs.

### Related: a bulk publish discards newer drafts

On a collection with drafts, `payload.update({ where, data, draft: false })` starts from the live documents and drops their newer drafts, while `payload.update({ id, data, draft: false })` starts from the latest draft (`getLatestCollectionVersion`) and publishes it together with `data`. The two paths behave differently for the same intent. Possibly worth its own issue.

### Environment

Payload 3.90.2, reproduced on `@payloadcms/db-sqlite`. The id matching is adapter-independent.
