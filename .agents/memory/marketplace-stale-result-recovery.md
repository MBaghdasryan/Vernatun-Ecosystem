---
name: Marketplace stale-result recovery
description: Keep withdrawn listing entries from resurfacing across mounted marketplace searches.
---

When a renter returns from a listing that became unavailable, remove it from all cached marketplace search results for the resident context before refreshing. Invalidating only the currently selected search is not enough when other mounted marketplace views hold separate cached query keys.

**Why:** An isolated mobile browser journey showed stale listing entries surviving the return-to-results path when multiple marketplace searches were mounted.

**How to apply:** When adding marketplace result caching or stale-listing recovery, update matching cached result sets across the current resident context, then refresh from the server.
