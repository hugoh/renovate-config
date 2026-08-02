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

- `config:best-practices` + `:automergeAll` + `:automergeBranch`
- Vulnerability alerts: labeled `security`, automerged, checked anytime
  (`presets/vulnerability-alerts.json`)
- Update grouping: major updates ungrouped and not automerged
  (`presets/major-updates-ungrouped.json`); non-major updates grouped by
  manager (GitHub Actions grouped separately from everything else)
- `npm:renovate` mise updates throttled to weekly via `chain-debounce`
  (`presets/npm-renovate-debounce.json`)
- Node.js versions from mise use LTS-aware versioning, so only Node
  releases that reach LTS status are proposed (`presets/node-lts.json`)

`go-tools/go-renovaterc.json` intentionally does **not** extend this
preset wholesale — it predates it and encodes a deliberately different,
more conservative policy for the Go cluster (longer `minimumReleaseAge`,
narrower automerge scope). It does, however, extend the
`vulnerability-alerts` and `major-updates-ungrouped` fragments above,
since those two are identical across both clusters — only the genuinely
divergent policy is kept separate. `spoon-tools/default.json` extends
this preset directly and layers one extra rule on top.
