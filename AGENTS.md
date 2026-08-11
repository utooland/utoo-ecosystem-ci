# Repository guidelines

## Structure

- `src/cli.mjs` clones a consumer, applies candidate overrides, and executes a suite.
- `src/suites.mjs` is the declarative source of truth for consumer repositories and commands.
- `scripts/prepare-candidate.mjs` builds and packs an utoo source checkout once for CI fan-out.
- `.github/workflows/ecosystem-ci.yml` provides scheduled, manual, dispatch, and reusable entry points.
- `workspace/` and `candidate-artifacts/` are disposable and must stay untracked.

## Validation

Use Utoo as this repository's package manager and `@utoo/lint` as its code linter. Run `ut install`, `ut test`, `ut lint`, and `ut check:workflow` after changes. Use `ut ecosystem -- --suite <name> --pack latest --dry-run` to inspect a suite plan. Full suites clone external repositories and can be expensive.

## Conventions

Use Node.js 22 and ESM. Keep process execution argument-based (`spawn` without a shell), preserve existing consumer manifest fields, and pin external GitHub Actions to full commit SHAs.
