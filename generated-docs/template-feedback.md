# Template Feedback

## [template] window.localStorage is undefined in Vitest on Node 25+
- Symptom: `TypeError: Cannot read properties of undefined (reading 'clear')` at `window.localStorage.clear()`; Node logs "localStorage is not available because --localstorage-file was not provided." Node's experimental global Web Storage shadows jsdom's.
- Workaround applied: `web/vitest.setup.ts` installs an in-memory `Storage` for `localStorage` / `sessionStorage` when the global is missing.
- Suggested fix: ship that shim in the template's `vitest.setup.ts`.
- Affected: `web/vitest.setup.ts`; Vitest 4.1 + jsdom on Node 26.13.0 (Windows)

## [template] `shadcn add switch` emits non-resolvable imports and stray dependencies
- Symptom: generated `switch.tsx` imported `cn` from `"cn"` and `Switch` from `"radix-ui"`, and the CLI added `cn` and `radix-ui` to `web/package.json`.
- Workaround applied: reverted `package.json` / lockfile, installed `@radix-ui/react-switch`, and repointed the imports to `@/lib/utils` and `@radix-ui/react-switch`.
- Suggested fix: pin the registry style in `web/components.json` (or post-process the CLI output) so it emits the template's import paths.
- Affected: `web/components.json`, shadcn CLI
