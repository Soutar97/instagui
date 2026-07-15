# Releasing instagui

**Publishing is CI-only.** From now on, `npm publish` never runs on a laptop —
the [`Release` workflow](.github/workflows/release.yml) publishes to npm with
provenance when a GitHub Release is published. Do not run `npm publish` locally.

## How to cut a release

1. **Bump the version** on a branch and open a PR:
   ```sh
   npm version patch --no-git-tag-version   # or: minor / major
   ```
   Commit the `package.json` (+ `package-lock.json`) change, get it reviewed,
   and merge to `main`. (Do not push tags from your machine — the tag comes from
   the GitHub Release in the next step.)

2. **Publish a GitHub Release** targeting `main`, with the tag `vX.Y.Z` matching
   the version you bumped to (e.g. `v0.2.1`). Add release notes.

3. **CI publishes.** Publishing the Release triggers the `Release` workflow,
   which builds, tests, verifies the version isn't already on the registry, and
   runs `npm publish --provenance` via OIDC. No token is stored anywhere.

## Guardrails

- The workflow **fails if `package.json`'s version already exists on npm** — so a
  release without a version bump stops cleanly instead of erroring mid-publish.
- Trigger is **`release: published` only** — pushes, PRs, and bare tags do not
  publish.
- Authentication is **OIDC Trusted Publishing** (no long-lived npm token in the
  repo or CI secrets). One-time npmjs.com setup is required — see the
  provenance-release PR description.
