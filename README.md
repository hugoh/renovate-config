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
   `go-renovaterc`): the timezone, the first-weekend monthly window,
   vulnerability alerts and `hugoh/hk-config//renovate.json` (how to *read* the
   hk pins, see below).
2. **Soak and schedule**: a 7-day `minimumReleaseAge` for third parties (from
   `presets/base`), 1 day for `hugoh/**` (`presets/first-party-soak`), and the
   monthly window (`presets/monthly-weekend`) for everything not overridden
   below (major updates).
3. **Groups**: all minor updates in one PR (`minor updates`); patch, pin and
   digest updates in another (`patch updates`). Both use the weekend window.
4. **First-party fast lane**: the reusable workflows and composite actions in
   my own repos propagate within a day and automerge (`first-party
   gh-workflows`).
5. **`linters`** and **`renovate CLI`**: below the generic groups so they win
   over them, with the linters on the monthly window and the renovate CLI on
   `presets/saturday-early` (see below).
6. **`biome toolchain`**: last, so it wins over the generic groups, on the same
   monthly window as the linters (see below).

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
uses it for the weekly minor and patch/pin/digest groups. Extend it at the
top level or inside a `packageRules` entry:

```json
"extends": ["github>hugoh/renovate-config//presets/weekend"]
```

### The Go cluster

`go-tools/go-renovaterc.json` intentionally does **not** extend this
preset wholesale: it keeps its own groups for the Go cluster. It does extend
`presets/base` and, for `hugoh/**`, `presets/first-party-soak`, so the shared
policy is identical across both clusters. `spoon-tools/default.json`
extends this preset directly and layers a `lua` version ceiling on top.

### `presets/monthly-weekend`

Replaces `schedule:monthly` and `:maintainLockFilesMonthly`: updates and lock
file maintenance run in the first weekend of the month, Friday 5pm to Sunday
5am around the first Saturday, instead of 00:00–03:59 on the 1st. The 36-hour
window leaves `prHourlyLimit` time to work through every branch, and the
updates land when there is time to fix anything that breaks. The Friday part
only counts on days 1–6 (a Friday the 7th is the second weekend), and the
window can be 29 hours when the first Saturday is the 1st. The base config uses
it, so every hub's major updates and lock file maintenance share it; go-tools'
`go-renovaterc` uses it for its own majors and monthly dev tool groups.

### `presets/chain-debounce`

Holds a frequently released dependency (one that ships several times a week
and would otherwise open a PR for each) to the weekend window. It is just
`presets/weekend` under a name that says why it is used; extend it inside a
`packageRules` entry. Not used in this repo's own rules any more (the biome
toolchain moved to `presets/monthly-weekend`, `npm:renovate` to
`presets/saturday-early`); go-tools' Copier update rule still uses it.

### `presets/saturday-early`

Saturday before 5am: one short window a week, for the renovate CLI, which ships
daily and would otherwise open one PR per run inside the 36-hour weekend window.

### The always-on fragments

Small presets the config always extends:

- `npm-renovate-debounce` puts the mise-managed `npm:renovate` pin in its own
  `renovate CLI` group on `presets/saturday-early`. `default.json` repeats the
  rule below the generic groups (see "Rule order matters"); go-tools, which
  doesn't extend `default.json`, gets it through this preset.
- `node-lts` makes the mise manager treat `node` versions with Node's
  versioning, so only LTS-style bumps are proposed.
- `jsdelivr-npm` is a regex manager for `cdn.jsdelivr.net/npm/<pkg>@<ver>/`
  links in `.html`/`.j2`/`.njk` files (the built-in html manager only reads
  cdnjs). It can't refresh SRI hashes, so those links must not carry
  `integrity`.
- `vulnerability-alerts` labels security PRs, automerges them at any time and
  only waits 6 hours.

### `presets/base`

Policy every hub shares, so it is defined once: the timezone the schedule
presets are evaluated in (`America/Chicago`), the 7-day third-party
`minimumReleaseAge`, `presets/monthly-weekend`, `presets/vulnerability-alerts`,
and `hugoh/hk-config//renovate.json` (how to read the hk pins). `default.json` and
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

### Rule order matters

Renovate applies `packageRules` top to bottom and the last matching rule wins
for each field. A hub's own rules come after everything pulled in through
`extends`, and the generic `minor updates` / `patch updates` groups would
override the `groupName` of any group rule above them. That is why a
dependency-specific group must come after them.

The `linters` group is one of these: the pinned linters in the repo-root
`mise.toml` move monthly, in one PR, on `presets/monthly-weekend`. It needs its
own `groupName` (a group whose members have different schedules ends up on the
wrong one) and has to sit below the generic groups and above `biome toolchain`.
Its tool list is the tools behind hk-config's `base.pkl` steps, plus
`editorconfig-checker`. `base.pkl`'s `stepTools` maps each hk step to the mise
tool behind it, and `scripts/check-package-rules.mjs` evaluates it from the
hk-config version pinned in `hk.pkl` (or the `base.pkl` named by
`HK_CONFIG_BASE_PKL`, to try an unreleased hk-config) and fails when a tool is
in neither the `linters` rule nor the script's exclusions (biome and
`npm:renovate` have their own groups, tofu and trivy stay weekly), or when the
rule lists a tool hk-config no longer runs. Since the check also runs when
Renovate bumps the hk-config pin, a new linter shows up as a failing PR rather
than as a tool that quietly stays weekly.

`npm:renovate` has the same problem: `npm-renovate-debounce` extends before the
generic groups, which then replace its group and schedule, so `default.json`
repeats it as the `renovate CLI` rule below them.

The `biome toolchain` group (an inline rule in `default.json`) is such a group
(and it also looks both biome entries up on npm, because the mise manager's own
`github-tags` lookup finds no biome updates):
the `biome` pin in `mise.toml` and the `$schema` URL in
`biome.json` are read by different managers, so without a shared group one can
land a release before the other and biome reports a schema/CLI version
mismatch. Its matcher is the last rule in `default.json`. Biome is a linter and
formatter, so the group follows the linters onto `presets/monthly-weekend`
(majors included, where they would otherwise be the one major that landed
weekly): a release that adds a rule or reformats code can fail CI, and a month
of batching keeps that to one PR. The schedule is the group's, so the pin and
the `$schema` always move in the same window.
`scripts/check-package-rules.mjs` (the `package-rules` step in `hk.pkl`)
enforces this: it resolves the presets from this checkout, runs the rules
through Renovate's own matcher and fails if the biome pins stop sharing the
group or window, or if the generic groups, soaks or schedules change.

### The hk pins

`hugoh/hk-config//renovate.json` (through `presets/base`) teaches Renovate how
to read the `jdx/hk` and `hugoh/hk-config` pins: custom managers for `.pkl`
and `mise.toml`, and disabling the built-in `mise` manager for `hk`. They are
not grouped: each lands in the generic groups with its own soak (7 days for
`jdx/hk`, 1 day for `hugoh/hk-config`). They don't need to move together: a
consumer can run an hk newer than its hk-config release was built against, and
an hk-config release that needs a newer hk fails CI through `min_hk_version`
until the `jdx/hk` bump lands (see hk-config's README).
