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

## How it all fits together

Every repo extends one of three hubs, and all three sit on
[`presets/base`][base]:

```mermaid
flowchart TD
  hkc["hugoh/hk-config//presets/hk-pins<br/>(how to read the hk pins)"] --> base
  base["presets/base<br/>timezone · soak · monthly window · vuln alerts"]
  base --> default["default.json<br/>github>hugoh/renovate-config"]
  base --> go["go-tools: go-renovaterc.json"]
  default --> plain["most repos"]
  default --> spoon["spoon-tools: default.json<br/>lua ceiling · hs-mock pin"]
  spoon --> spoons["*.spoon, hs-mock"]
  go --> gotools["go-tools (own .renovaterc.json)"]
  go --> gorepos["Go repos (Copier-generated .renovaterc.json)"]
```

- **`github>hugoh/renovate-config`** ([`default.json`][default],
  [repos that use it][default-users]): every repo that isn't a spoon or a Go
  project, plus `spoon-tools` itself. Releasing repos add
  `presets/action-repo` (`gh-workflows`) or `presets/action-file` (`cog-bump`,
  `digest-action`, `rerun-transient-failures`, `checkly-config`); `spoon-tools`
  types only the bumps in its published `spoon-release.yml` as `fix`.
- **`github>hugoh/spoon-tools`** ([`default.json`][spoon],
  [repos that use it][spoon-users]): the Hammerspoon spoons and `hs-mock`. It is
  `default.json` plus a `lua` ceiling and a regex manager for the
  `HS_MOCK_VERSION` pin in `mise.toml`.
- **`github>hugoh/go-tools:go-renovaterc`** ([`go-renovaterc.json`][go],
  [repos that use it][go-users]): the Go repos. It does **not**
  extend `default.json`: it has its own groups (`GitHub Actions`,
  `Go dependencies`) and runs everything on the weekend window except majors.
  The Go repos' `.renovaterc.json` is itself a Copier output that adds
  [`presets/binary`][go-binary] or [`presets/library`][go-library] and
  [`presets/copier-owned-files`][go-copier].

### Who moves which pin

| Pin | Moved by |
|---|---|
| Ordinary dependencies, actions, `mise.toml` tools | Renovate, per the hub's groups |
| `jdx/hk` and `hugoh/hk-config` in `*.pkl` / `mise.toml` | Renovate, through [hk-config's custom managers][hk-config] (the built-in `mise` manager is off for `hk`) |
| A Go repo's `mise.toml`, `hk.pkl`, `ci.yml` / `semantic-pr.yml` workflow pins | Copier only: `copier-owned-files` and `go-renovaterc` switch Renovate off for them, and the go-tools template update PR brings the new pins |
| The same pins in go-tools' `template/` | Renovate in go-tools (`template dev tools`, typed `fix` so a release fans them out) |
| A Go repo's toolchain (`.config/mise/conf.d/go.toml`) | Renovate (seeded once by Copier, then never re-rendered) |
| Spoon versions in chezmoi's `hammerspoon.yaml` | [chezmoi's own regex manager][chezmoi] |

### When things land

| Window | What |
|---|---|
| Any time | Vulnerability fixes (6-hour soak), `first-party core` in the repos that own it (12 hours), Go patch toolchain bumps in binary repos (1 day) |
| Saturday before 5am | `renovate CLI` |
| Weekend (Fri 5pm–Sun 5am) | `dependency updates`, `first-party updates`; in the Go hub, everything but majors, including the go-tools template update |
| Weekend (Fri 5pm–Sun 5am) | …plus tooling majors (GitHub Actions, mise, Copier, pre-commit, the hk pins), which automerge once CI is green |
| First weekend of the month | Majors of shipped code, lock file maintenance; go-tools' `dev tools` / `template dev tools` |
| Repo-specific | chezmoi runs `hugoh/**` (except hk-config) daily and lock files weekly; go-tools keeps `golangci-lint` weekly |

Soaks: 7 days for third parties (`presets/base`), 1 day for `hugoh/**`
(`presets/first-party-soak`), and 7 days for hk-config so it can't mature before
the hk it needs.

### How Renovate resolves a group

Checked against Renovate 44's `workers/repository/updates/generate.js`. These
rules explain most of the rule-order constraints below:

- **Schedule**: the branch takes the config of the update whose `depName` sorts
  first, so a group whose members have different schedules runs on an
  arbitrary one. Every group here has a single schedule; a consumer override
  that only matches some members of a group (a daily `hugoh/**` rule, a
  catch-all `groupName`) breaks that.
- **Soak**: each update matures on its own. A group branch drops the members
  still inside their `minimumReleaseAge` and picks them up on a later run, which
  is why hk and hk-config share the 7-day soak.
- **Commit type**: the highest-priority type among the members wins (`fix` over
  `chore`), so one `fix` member makes the whole group cut a release.
- **Automerge**: only when every member allows it.

[base]: presets/base.json
[default]: default.json
[default-users]: https://github.com/search?q=org%3Ahugoh+%22github%3Ehugoh%2Frenovate-config%22+path%3A%2F%28%5E%7C%5C%2F%29%5C.%3Frenovate%28rc%29%3F%5C.json%24%2F&type=code
[spoon]: https://github.com/hugoh/spoon-tools/blob/main/default.json
[spoon-users]: https://github.com/search?q=org%3Ahugoh+%22github%3Ehugoh%2Fspoon-tools%22&type=code
[go]: https://github.com/hugoh/go-tools/blob/main/go-renovaterc.json
[go-users]: https://github.com/search?q=org%3Ahugoh+%22github%3Ehugoh%2Fgo-tools%3Ago-renovaterc%22&type=code
[go-binary]: https://github.com/hugoh/go-tools/blob/main/presets/binary.json
[go-library]: https://github.com/hugoh/go-tools/blob/main/presets/library.json
[go-copier]: https://github.com/hugoh/go-tools/blob/main/presets/copier-owned-files.json
[hk-config]: https://github.com/hugoh/hk-config/blob/main/presets/hk-pins.json
[chezmoi]: https://github.com/hugoh/config/blob/chezmoi/.renovaterc.json

## What the base config does

`default.json` is the fleet policy. In the order Renovate applies it:

1. **Extends** Renovate's `config:best-practices` and the presets under
   `presets/`, chiefly `presets/base` (shared with go-tools' `go-renovaterc`):
   the timezone, the first-weekend monthly window, vulnerability alerts,
   automerge and `hugoh/hk-config//presets/hk-pins` (how to *read* the hk pins,
   see below).
2. **Soak and schedule**: a 7-day `minimumReleaseAge` for third parties and 1
   day for `hugoh/**` (both from `presets/base`), and the monthly window
   (`presets/monthly-weekend`) for everything not overridden below (major
   updates).
3. **Groups**: every minor, patch, pin and digest update in one PR
   (`dependency updates`), on the weekend window. Majors are never grouped.
   Minors and patches used to be two groups because they ran on different
   schedules; with one window the split had no reason left. The cost: a red
   update turns the whole weekly PR red, patches and digests included, until
   it is fixed.
4. **First-party**: minor, patch, pin and digest updates of `hugoh/**` get
   their own group (`first-party updates`) so a consumer can give them a
   different schedule; the core packages (reusable workflows, composite
   actions, shared tooling) propagate within a day and automerge (`first-party
   core`). The exception is the `hugoh/hk-config` pin (`hk`, with `jdx/hk`, see
   "The hk pins").
5. **`hk`** and **`renovate CLI`**: below the generic groups so they win over
   them: `jdx/hk` and `hugoh/hk-config` in one PR, and the renovate CLI on
   `presets/saturday-early` (see below).

A consuming repo's own `packageRules` come after all of this, so they can
override any of it.

### `presets/action-repo` and `presets/action-file`

Repos that release from conventional commits need dependency bumps typed
`fix` (not `chore`) so `cog bump --auto` cuts a release. Extend one of:

- `github>hugoh/renovate-config//presets/action-repo` — **every**
  github-actions bump is `fix`. For repos whose CI content *is* the
  released artifact (reusable-workflow repos: `gh-workflows`).
- `github>hugoh/renovate-config//presets/action-file` — only a bump to
  the published `action.yml` is `fix`. For composite-action repos
  (`cog-bump`, `digest-action`, `rerun-transient-failures`,
  `checkly-config`).

### Who automerges (`presets/automerge`)

Much of what Renovate bumps here is tooling that never ships: GitHub Actions,
mise tools (linters, `pinact`, `node` for the build, ...), Copier updates, the
hk pins and the biome `$schema`. CI is the judge for those, so they automerge
at **every** update type, majors included. Everything else (Go modules,
crates, npm and PyPI dependencies, CDN links) keeps what `:automergeMinor`
(`presets/base`) already merges: minors, patches, pins and lock file
maintenance; its **majors** wait for me. Digests (`:automergeDigest`),
`first-party core` and everything else that sets `automerge` itself are
unchanged.

Tooling majors also take the weekend window instead of waiting for the first
weekend of the month: with automerge there is no pile to triage, and repos
drift less. The soak stays at 7 days (longer buys little: compromises and bad
releases surface within days, and CI is the real gate). The renovate CLI keeps
its own window; biome is on the weekend window too. The Go hub's catch-all
major rule skips these managers so they keep the weekend window. Majors of
shipped code stay on the monthly window, since I merge them by hand.

The preset sets no groups, so it can sit in `presets/base` (before the hubs'
own rules) without being overridden.

A group only automerges when every member does. Majors are the only updates
that differ between tooling and shipped code, and they are ungrouped, so no
group mixes the two kinds; the `package-rules` step fails if one starts to.

Things to know:

- The hk pins and the biome `$schema` are read by custom managers, so the
  preset matches them by package name. Without that, a biome major would
  merge itself in `mise.toml` and wait for me in `biome.json`.
- `hk` and `hk-config` majors are not grouped (the `hk` rule is minor and
  patch only). If an hk-config major needs a newer hk, its PR fails CI until
  the hk major has merged, then Renovate rebases it and it merges.
- A repo whose tools are the product, not what builds it (chezmoi's global
  mise files), should turn tooling majors off for those files in its own
  rules.
- Branch protection needs a required check (an aggregate "ci" job), or
  platform automerge merges before CI has run.

### `presets/weekend`

A `schedule` for Friday 5pm to Sunday 5am: updates land at the start of
the weekend, leaving time to fix anything that breaks. The base config
uses it for the weekly `dependency updates` group. Extend it at the
top level or inside a `packageRules` entry:

```json
"extends": ["github>hugoh/renovate-config//presets/weekend"]
```

### The Go cluster

`go-tools/go-renovaterc.json` intentionally does **not** extend this
preset wholesale: it keeps its own groups for the Go cluster. It does extend
`presets/base`, so the shared policy is identical across both clusters. `spoon-tools/default.json`
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

### `presets/saturday-early`

Saturday before 5am: one short window a week, for the renovate CLI, which ships
daily and would otherwise open one PR per run inside the 36-hour weekend window.

### The always-on fragments

Small presets the config always extends:

- `node-lts` makes the mise manager treat `node` versions with Node's
  versioning, so only LTS-style bumps are proposed.
- `jsdelivr-npm` is a regex manager for `cdn.jsdelivr.net/npm/<pkg>@<ver>/`
  links in `.html`/`.j2`/`.njk` files (the built-in html manager only reads
  cdnjs). It can't refresh SRI hashes, so those links must not carry
  `integrity`.
- `vulnerability-alerts` labels security PRs, automerges them at any time and
  only waits 6 hours.

`npm-renovate-debounce` puts the mise-managed `npm:renovate` pin in its own
`renovate CLI` group on `presets/saturday-early`. It is for go-tools, which
doesn't extend `default.json`; `default.json` has the same rule inline, below
the generic groups (see "Rule order matters").

### `presets/base`

Policy every hub shares, so it is defined once: the timezone the schedule
presets are evaluated in (`America/Chicago`), the 7-day third-party
`minimumReleaseAge` and the 1-day one for `hugoh/**`
(`presets/first-party-soak`), `presets/monthly-weekend`,
`presets/vulnerability-alerts` plus OSV alerts, `presets/automerge`,
Renovate's `:automergeLinters`, `:automergeMinor` (keep it: it is what merges
`pin` and lock file maintenance updates, not just minor and patch) and
`:automergeDigest`, and `hugoh/hk-config//presets/hk-pins` (how to read the hk
pins). `default.json` and
go-tools' `go-renovaterc.json` extend it and add their own ecosystem rules and
groups on top.

### `presets/first-party-soak`

A 1-day `minimumReleaseAge` for my own packages (actions, reusable workflows,
spoons, go-tools). `presets/base` already applies it to `hugoh/**`. A preset
cannot carry `match*` options, so it is extended from a `packageRule` that
matches the first-party packages:

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
`extends`, and the generic `dependency updates` group would override the
`groupName` of any group rule above them. That is why a dependency-specific
group must come after them.

The `hk` group is one of these (it needs its own `groupName`, which has to sit
below the generic groups). Linters themselves have no rule: a pinned linter is
tooling like the rest and joins the generic weekly groups, so there is no tool
list to keep in sync with hk-config.

`npm:renovate` has the same problem: a rule pulled in through `extends` (such
as `npm-renovate-debounce`'s) would come before the generic groups, which would
replace its group and schedule, so `default.json` has its own `renovate CLI`
rule below them.

Biome has a rule in `default.json` only for its lookup: the mise manager's own
`github-tags` lookup finds no biome updates (the tags are named
`@biomejs/biome@<version>`), so the pin looks up on npm like the `$schema` URL
in `biome.json` does. Otherwise biome is tooling like the rest, with no group
or schedule of its own: both members join `dependency updates` and land in the
same weekly PR, and automerge. Majors are ungrouped, so a biome major can
arrive as two PRs; biome only warns when the `$schema` version differs from
the CLI's, and the other one follows within the same run. If that ever starts
failing CI, group the two majors again.
`scripts/check-package-rules.mjs` (the `package-rules` step in `hk.pkl`)
enforces the rest: it resolves the presets from this checkout, runs the rules
through Renovate's own matcher and fails if the generic groups, soaks or
schedules change.

### The hk pins

`hugoh/hk-config//presets/hk-pins` (through `presets/base`) teaches Renovate how
to read the `jdx/hk` and `hugoh/hk-config` pins: custom managers for `.pkl`
and `mise.toml`, and disabling the built-in `mise` manager for `hk`. They are
moved in one go: `jdx/hk` and `hugoh/hk-config` both join the `hk` group
on the weekend window, with the 7-day soak (hk-config's own 1-day soak would
let it mature before the hk it needs), since a release of either can fail CI
and hk-config needs a minimum hk (`min_hk_version`; see hk-config's README).
Not in the hk-config repo itself, where hk is part of the project rather than
a tool it lints with: there
`jdx/hk` stays in the generic groups.
