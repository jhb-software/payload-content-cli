---
title: "Check shared rows after Payload's access check, not before it"
type: fix
status: draft
---

# Check shared rows after Payload's access check

`preserveSharedRowsPlugin` reads the stored document itself in `beforeOperation`, with the caller's access, because the rows' ids are gone by the time later hooks run. Reading as the caller closes the row id leak, but the guard can only protect what the caller can read.

## What this leaves open

Reproduced over REST with `0.6.0-beta.3` plus the access fix:

- **Bulk update reaching unreadable documents:** with `read` limited by a `Where` and `update: () => true`, a bulk `PATCH` matching a document outside the read rule returns 200 and replaces its rows. The other locales' translations are lost.
- **Field hidden from the caller:** with field-level `read: () => false` on the shared array and collection-level `update: () => true`, a by-ID `PATCH` returns 200 and replaces the rows.

- **Callers blocked from shared fields:** a caller who may update but not read can't write a shared field at all, through REST, GraphQL, the MCP `update` tool or a Local API call with `overrideAccess: false`. With `read: () => false` they get a 403. With a `Where` read rule that excludes the document they get a 404 by ID. Their other writes pass.

All three need update access that is wider than read access, which is unusual. No app is known to depend on it, though afx hasn't been checked.

## Idea

Keep a copy of the incoming rows in `beforeOperation`, without reading anything, and compare them in a document-level hook that receives Payload's `originalDoc`, after Payload has checked access. That removes the guard's own read and its access question.

## Open questions

- Bulk updates would stop being all-or-nothing: Payload writes document by document, so earlier documents could already be saved when a later one is refused. Is that acceptable, or does it need a transaction?
- Does `originalDoc` hold what the guard needs for drafts, and for the request's locale and fallback locale?
- Should a refusal to an update-only caller name row ids? They can't send a valid write without them, and Payload's update response already returned the document in testing.

Don't reopen the alternative of reading with access off after checking update access by hand. It repeats Payload's access logic, and a `where` filter would skip field-level checks, which brings filter probing back.
