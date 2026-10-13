# Changelog

## 0.1.0
- Initial implementation of stages 2–8 of the action plan: OAuth + encrypted token store, hardened API client, 22 read tools (including read-only trust/bank tools), gated create/update/delete tools, confirmation tokens, audit log, duplicate protection, 90+ tests.
- Tool names follow `clio_{verb}_{entity}`; renaming a tool is a breaking change. Pin `CLIO_API_VERSION` and test before bumping.
