# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) config for my repos, hosted as a
[preset](https://docs.renovatebot.com/config-presets/).

## Usage

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>hugoh/renovate-config#1"]
}
```

Repos with their own additional rules (version pins, extra managers, etc.) list
`github>hugoh/renovate-config` first in their `extends` array and add their own
`packageRules` afterward.

## What's in the base preset

- `config:best-practices` + `:automergeAll` + `:automergeBranch`
- Vulnerability alerts: labeled `security`, automerged, checked anytime
- Update grouping: major updates ungrouped and not automerged; non-major
  updates grouped by manager (GitHub Actions grouped separately from
  everything else)
- [`kachick/renovate-config-dprint`](https://github.com/kachick/renovate-config-dprint)
  for `dprint.json` plugin version updates (Renovate has no built-in dprint
  manager)

`go-tools/default.json` and `spoon-tools/default.json` intentionally do **not**
extend this preset — they predate it and encode a deliberately different,
more conservative policy for their own clusters (Go services, Hammerspoon
spoons). This repo is for everything else.

## Versioning

Releases follow [SemVer](https://semver.org/) and are tagged automatically by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/) on `main`. Each
release gets an immutable `vX.Y.Z` tag, and a floating `v{major}` tag (e.g.
`v1`) always points at the latest release within that major version.

Extend `github>hugoh/renovate-config#1` to automatically track non-breaking
updates within major version 1, or pin an exact release with
`github>hugoh/renovate-config#1.2.3` for full reproducibility. See
[`CHANGELOG.md`](CHANGELOG.md) for release notes.
