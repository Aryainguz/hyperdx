---
'@hyperdx/api': patch
---

fix: parse request bodies over 100kb only for callers with a session or a valid
API key. Anonymous requests could make the API buffer and parse 32 MB before
the route rejected them.
