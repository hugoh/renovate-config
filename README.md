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

## What the base config does

`default.json` is the fleet policy. In the order Renovate applies it:

1. **Extends** Renovate's `config:best-practices` and automerge presets, and
   the presets under `presets/`, chiefly `presets/base` (shared with go-tools'
   `go-renovaterc`): the timezone, the monthly window, vulnerability alerts and
   `hugoh/hk-config//renovate.json` (how to *read* the hk pins, see below).
2. **Soak and schedule**: a 7-day `minimumReleaseAge` for third parties (from
   `presets/base`), 1 day for `hugoh/**` (`presets/first-party-soak`), and the
   monthly window for everything not overridden below.
3. **Groups**: all minor updates in one PR (`minor updates`); patch, pin and
   digest updates in another (`patch updates`, weekend window).
4. **First-party fast lane**: the reusable workflows and composite actions in
   my own repos propagate within a day and automerge (`first-party
   gh-workflows`).
5. **`hk toolchain`**: last, so it wins over the generic groups (see below).

A consuming repo's own `packageRules` come after all of this, so they can
override any of it.

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

### `presets/weekend`

A `schedule` for Friday 5pm to Sunday 5am: updates land at the start of
the weekend, leaving time to fix anything that breaks. The base config
uses it for the weekly patch/pin/digest group and, through `chain-debounce`,
for the hk toolchain. Extend it at the top level or inside a `packageRules`
entry:

```json
"extends": ["github>hugoh/renovate-config//presets/weekend"]
```

### The Go cluster

`go-tools/go-renovaterc.json` intentionally does **not** extend this
preset wholesale — it encodes a deliberately more conservative policy for
the Go cluster. It does reuse the `vulnerability-alerts`
fragment, since that's identical across both clusters. `spoon-tools/default.json`
extends this preset directly and layers a `lua` version ceiling on top.

### `presets/monthly`

Replaces `schedule:monthly` and `:maintainLockFilesMonthly`: updates and
lock file maintenance run all day on the 1st, not just 00:00–03:59, so
`prHourlyLimit` can't leave branches unprocessed until next month. The
base config uses it.

### `presets/chain-debounce`

Holds a frequently released dependency (one that ships several times a week
and would otherwise open a PR for each) to the weekend window. It is just
`presets/weekend` under a name that says why it is used; extend it inside a
`packageRules` entry. Used for `npm:renovate` and the hk toolchain.

### The always-on fragments

Three small presets the base config always extends:

- `npm-renovate-debounce` applies `chain-debounce` to the mise-managed
  `npm:renovate` pin.
- `node-lts` makes the mise manager treat `node` versions with Node's
  versioning, so only LTS-style bumps are proposed.
- `vulnerability-alerts` labels security PRs, automerges them at any time and
  only waits 6 hours.

### `presets/base`

Policy every hub shares, so it is defined once: the timezone the schedule
presets are evaluated in (`America/Chicago`), the 7-day third-party
`minimumReleaseAge`, `presets/monthly`, `presets/vulnerability-alerts`, and
`hugoh/hk-config//renovate.json` (how to read the hk pins). `default.json` and
go-tools' `go-renovaterc.json` extend it and add their own ecosystem rules and
groups on top.

### `presets/first-party-soak`

A 1-day `minimumReleaseAge` for my own packages (actions, reusable workflows,
spoons, go-tools). A preset cannot carry `match*` options, so extend it from a
`packageRule` that matches the first-party packages:

```json
{
  "matchPackageNames": ["hugoh/**"],
  "extends": ["github>hugoh/renovate-config//presets/first-party-soak"]
}
```

go-tools releases several times a day, so the 7-day third-party soak kept
restarting and its copier updates never matured; this is the fix.

### `presets/hk-toolchain`

Policy for the `jdx/hk` and `hugoh/hk-config` pins: they move in **one** PR
(group `hk toolchain`), after a 1-day soak, in the weekend window, so the Pkl
schema pin, the CLI pin in `mise.toml` and the `base.pkl` they were validated
against never drift apart.

A preset cannot carry `match*` options (the validator rejects them), so every
hub that extends `hugoh/hk-config//renovate.json` adds the matcher itself, as
its **last** `packageRule`:

```json
{
  "matchManagers": ["custom.regex"],
  "matchPackageNames": ["jdx/hk", "hugoh/hk-config"],
  "extends": ["github>hugoh/renovate-config//presets/hk-toolchain"]
}
```

Hubs today: this repo's `default.json` and `go-tools`' `go-renovaterc.json`
(which does not extend `default.json`, but does extend `presets/base`).

### Rule order matters (and the hk toolchain group)

Renovate applies `packageRules` top to bottom and the last matching rule wins
for each field. A hub's own rules come after everything pulled in through
`extends`, so a hub's generic `minor updates` / `patch updates` groups would
override a `groupName` set by an extended preset. That is why the matcher above
must be the last rule.

Ownership of the hk pins is split on purpose:

- `hugoh/hk-config//renovate.json` only teaches Renovate *how to read* the
  `jdx/hk` and `hugoh/hk-config` pins (custom managers for `.pkl` and
  `mise.toml`, and disabling the built-in `mise` manager for `hk`).
- `presets/hk-toolchain` decides *how they are grouped and when*.
- Each hub only says *where* the preset applies, with the matcher.

`scripts/check-hk-grouping.mjs` (the `hk-grouping` step in `hk.pkl`) enforces
this for `default.json`: it resolves the preset from this checkout, runs the
rules through Renovate's own matcher and fails if the two pins stop sharing the
`hk toolchain` group, soak and schedule.
