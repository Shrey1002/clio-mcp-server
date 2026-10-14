# Changelog

## 0.2.0
- Prompt-injection defences for untrusted Clio text: provenance labelling, sanitising (hidden Unicode, markup, image exfiltration, length caps), EN/FR detection with field-path flags, optional redaction, and human-approval containment of writes after suspected injection. Adds `CLIO_UNTRUSTED_TEXT_MODE` and `CLIO_INJECTION_POLICY`. See `docs/SECURITY.md`.
- Test suite grows to 170+ tests, including an attack/benign corpus and end-to-end containment tests.
- Request filters and fields verified against Clio's OpenAPI spec; added `clio_get_matter_protected_funds`.

## 0.1.0
- Initial implementation of stages 2–8 of the action plan: OAuth + encrypted token store, hardened API client, 22 read tools (including read-only trust/bank tools), gated create/update/delete tools, confirmation tokens, audit log, duplicate protection, 90+ tests.
- Tool names follow `clio_{verb}_{entity}`; renaming a tool is a breaking change. Pin `CLIO_API_VERSION` and test before bumping.
