---
title: Split config types
type: feature
status: todo
---

# Split config types

Replace the `optional fields + requireRemoteConfig` pattern with separate `LocalConfig` and `RemoteConfig` types, enforced by the type system instead of runtime assertions.

**Files:** `src/config.ts`, all files importing `Config`
