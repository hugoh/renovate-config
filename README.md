# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) config for my repos, hosted as a
[preset](https://docs.renovatebot.com/config-presets/).

## Usage

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>hugoh/renovate-config"]
}
```

Repos with their own additional rules (version pins, extra managers, etc.) list
`github>hugoh/renovate-config` first in their `extends` array and add their own
`packageRules` afterward.

## What's in the base preset

- `config:best-practices` (pins GitHub Action + Docker digests, config
  migration, `:pinDevDependencies`, weekly npm release-age gate, …) plus
  `:automergeAll`. `platformAutomerge` is left at its default (`true`), so
  automerges hand off to GitHub's native auto-merge where the repo has it
  enabled, and fall back to Renovate self-merge where it doesn't.
- `:preserveSemverRanges` — Renovate only rewrites a version constraint
  when the new version is out of range; in-range bumps are lockfile-only.
  Keeps `>=` floors in Python manifests from churning on every update.
- `minimumReleaseAge: "3 days"` globally, `timezone: America/Chicago`.
- `schedule:monthly` for regular updates; `:maintainLockFilesMonthly` for
  lock file maintenance. Vulnerability alerts and first-party workflow
  bumps (below) override this and run anytime.
- Vulnerability alerts: labeled `security`, automerged, checked anytime
  (`presets/vulnerability-alerts.json`).
- Update grouping: major updates are one PR per package and never
  automerged (`presets/major-updates-ungrouped.json`); everything else
  splits into two groups — `github actions updates` and a single
  `non-major updates` group for every other manager.
- First-party reusable workflows / composite actions
  (`hugoh/cog-bump`, `gh-workflows`, `go-tools`, `renovate-config`,
  `spoon-tools`, matched only when Renovate runs *in* one of those repos):
  a bump only reaches consumers once a new tag is cut, so it propagates
  within a day and automerges instead of waiting for the monthly run.
- `npm:renovate` mise updates throttled to weekly via `chain-debounce`
  (`presets/npm-renovate-debounce.json`).
- Node.js versions from mise use LTS-aware versioning, so only Node
  releases that reach LTS status are proposed (`presets/node-lts.json`).

### `presets/action-repo` and `presets/action-file`

Repos that release from conventional commits need dependency bumps typed
`fix` (not `chore`) so `cog bump --auto` cuts a release. Extend one of:

- `github>hugoh/renovate-config//presets/action-repo` — **every**
  github-actions bump is `fix`. For repos whose CI content *is* the
  released artifact (reusable-workflow repos: `gh-workflows`,
  `spoon-tools`).
- `github>hugoh/renovate-config//presets/action-file` — only a bump to
  the published `action.yml` is `fix`. For composite-action repos
  (`cog-bump`, `digest-action`, `rerun-transient-failures`).

### The Go cluster

`go-tools/go-renovaterc.json` intentionally does **not** extend this
preset wholesale — it encodes a deliberately more conservative policy for
the Go cluster (`config:recommended` base, 7-day `minimumReleaseAge`,
narrower automerge scope). It does reuse the `vulnerability-alerts` and
`major-updates-ungrouped` fragments, since those are identical across both
clusters. `spoon-tools/default.json` extends this preset directly and
layers a `lua` version ceiling on top.
