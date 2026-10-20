# Contributing

Open an issue before large changes. Keep PDF bytes local, avoid runtime CDNs, and add meaningful fixtures/tests for processing changes. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before a pull request. Include the before/after page count, text checks, sizes, and any feature preservation limits for compressor changes. Do not add dependencies without recording their licenses in `THIRD_PARTY_NOTICES.md`.

Translations live in separate files under `src/i18n/`. Keep every user-facing string translated in all eleven languages, including Arabic RTL and Vietnamese last in the selector.
