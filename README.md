<p align="center">
  <a href="https://github.com/utooland/utoo">
    <img src="https://mdn.alipayobjects.com/huamei_botco4/afts/img/357RTIva8S8AAAAAAAAAAAAADnNMAQFr/original" alt="Utoo Logo" height="80" />
  </a>
</p>

<h1 align="center">utoopack-ecosystem-ci</h1>

Continuously validates published releases and source-built `@utoo/pack` candidates against Umi, Ant Design Pro, Father, Dumi, and EVJS. Each suite injects the candidate into a fresh consumer checkout, runs its real utoopack build or E2E workflow in isolation, and verifies the expected output.

## Suites

| Suite | Consumer | E2E coverage |
| --- | --- | --- |
| `umi` | `umijs/umi@master` | Builds the Umi/plugin/utoopack packages, then builds four maintained utoopack examples |
| `ant-design-pro` | `ant-design/ant-design-pro@master` | Runs the production Umi Max + utoopack build |
| `father` | `umijs/father@master` | Builds Father, then builds its utoopack UMD example |
| `dumi` | `umijs/dumi@master` | Builds Dumi and its WASM crate, then builds the utoopack documentation example |
| `evjs` | `afx-team/evjs@main` | Builds the EVJS packages with its default `bundler-utoopack`, then runs the `utoopack` and `utoopack-scaffold` Playwright projects |

Every suite verifies that its expected output directory exists and is non-empty. Node.js 22 is used in CI, satisfying utoopack's Node.js 20+ requirement.

For EVJS, the runner also verifies the candidate from `packages/bundler-utoopack`'s module-resolution context. Its upstream lockfile currently contains a workspace-local `@utoo/pack` entry, so the disposable checkout removes that stale generated copy after installation before running E2E; this prevents the root override from producing a false-positive result.

## Run locally

Requirements: Node.js 22, Git, and [Utoo](https://github.com/utooland/utoo) 1.1.7. Dumi also needs Rustup because its build compiles a WASM crate.

```bash
ut install
ut test
ut lint
ut check:workflow

# Show suites
ut ecosystem -- --list

# Test a published version or dist-tag
ut ecosystem -- --suite father --pack latest
ut ecosystem -- --suite ant-design-pro --pack 1.5.3
ut ecosystem -- --suite evjs --pack latest

# Inspect the exact plan without cloning or installing
ut ecosystem -- --suite dumi --pack latest --dry-run
```

To test locally built tarballs:

```bash
node scripts/prepare-candidate.mjs \
  --source /path/to/utoo \
  --out candidate-artifacts

ut ecosystem -- \
  --suite umi \
  --pack candidate-artifacts/utoo-pack.tgz \
  --pack-shared candidate-artifacts/utoo-pack-shared.tgz
```

Consumer checkouts are disposable and live under `workspace/`. Use `--keep` to reuse an existing checkout, `--ref <branch|tag|commit>` to test a consumer ref, or `--repo <owner/repo>` to test a fork.

## GitHub Actions

The **Utoopack ecosystem CI** workflow supports four entry points:

- Daily schedule: all suites against the npm `latest` tag.
- Manual run: choose npm/source mode and one suite or all suites.
- `repository_dispatch`: event type `utoopack-ecosystem-ci` with the same values in `client_payload`.
- Reusable workflow: call it directly from the utoo repository so the result appears on the originating PR or commit.

In `npm` mode, `pack_spec` is an npm version or dist-tag. In `source` mode, the workflow checks out `utoo_repository@utoo_ref`, initializes the `next.js` submodule, builds the Linux x64 native package once, packs `@utoo/pack` and `@utoo/pack-shared`, and shares those tarballs with the five consumer jobs.

### Call from the utoo repository

Add a small workflow to the utoo repository:

```yaml
name: Ecosystem CI

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  ecosystem:
    uses: utooland/utoo-ecosystem-ci/.github/workflows/ecosystem-ci.yml@main
    with:
      candidate_mode: source
      utoo_repository: ${{ github.event.pull_request.head.repo.full_name || github.repository }}
      utoo_ref: ${{ github.event.pull_request.head.sha || github.sha }}
      suite: all
      harness_repository: utooland/utoo-ecosystem-ci
      harness_ref: main
```

No secrets are required for public repositories. GitHub-hosted runners need enough time and disk for the one-time Rust/NAPI source build; the source preparation job has a three-hour timeout and frees unused runner images first.

## Dispatch payload example

```bash
gh api --method POST repos/utooland/utoo-ecosystem-ci/dispatches \
  -f event_type=utoopack-ecosystem-ci \
  -f 'client_payload[candidate_mode]=npm' \
  -f 'client_payload[pack_spec]=latest' \
  -f 'client_payload[suite]=all'
```

## Maintenance

This repository itself uses Utoo (`ut install`, `ut test`, and `ut lint`) and keeps an npm-compatible `package-lock.json`, which Utoo reads and updates. JavaScript is linted with `@utoo/lint`; `ut check:workflow` separately enforces the GitHub Actions SHA policy. Consumer checkouts continue using the package manager declared by each upstream repository so package-manager behavior is not mixed into bundler compatibility results.

Suite commands live in `src/suites.mjs`. Keep them aligned with the consumer repositories' own CI and examples. External GitHub Actions are pinned to full commit SHAs; `ut check:workflow` enforces that policy.
