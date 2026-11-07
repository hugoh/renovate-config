#!/usr/bin/env node
// Regression check for default.json's packageRules (see README: "Rule order
// matters"). Runs them through Renovate's own rule matcher for synthetic
// updates and fails if the policy changes: the renovate CLI group (which
// must stay below the generic "dependency updates" rule, or
// their groupName replaces it), the generic groups themselves, the
// first-party / third-party soak, the schedules, and who automerges.
//
// Presets under presets/ that a rule extends are resolved from this checkout,
// the way Renovate merges them beneath the rule's own settings.
//
// Everything is local: the rule order inside default.json is what decides the
// outcome, because rules that come in through `extends` (hk-config's
// managers) are applied before them.
//
// Renovate is located via RENOVATE_DIR, or `mise where npm:renovate` (the
// mise-installed npm:renovate pinned in mise.toml).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(here, "..", "default.json"), "utf8"),
);

function isRenovate(dir) {
  const pkg = join(dir, "package.json");
  return (
    existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name === "renovate"
  );
}

// Depth-limited search for a `renovate` package directory. mise/aube install
// it under node_modules/.mise/renovate@<ver>_<deps>/node_modules/renovate.
function search(dir, depth) {
  if (isRenovate(dir)) return dir;
  if (depth === 0) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try {
      const found = search(join(dir, entry.name), depth - 1);
      if (found) return found;
    } catch {
      // unreadable or dangling entry: keep looking
    }
  }
  return undefined;
}

function findRenovate() {
  if (process.env.RENOVATE_DIR) return resolve(process.env.RENOVATE_DIR);
  const where = execFileSync("mise", ["where", "npm:renovate"], {
    encoding: "utf8",
  }).trim();
  const found = search(where, 7);
  if (!found)
    throw new Error(`no renovate package under ${where}; set RENOVATE_DIR`);
  return found;
}

const renovateDir = findRenovate();
const rules = join(renovateDir, "dist", "util", "package-rules", "index.js");
const { applyPackageRules } = await import(rules);
// Built-in presets are otherwise ignored here, but :automergeMinor decides who
// automerges (it also covers pin and lock file maintenance), so model it from
// Renovate's own definition: its per-update-type `automerge` blocks become
// packageRules, in the position the preset has in the extends chain.
const { presets: builtIn } = await import(
  join(renovateDir, "dist", "config", "presets", "internal", "default.preset.js")
);
function builtInRules(name) {
  const preset = builtIn[name.slice(1)];
  if (!preset) return [];
  return ["major", "minor", "patch", "pin", "digest", "lockFileMaintenance"]
    .filter((type) => preset[type]?.automerge)
    .map((type) => ({ matchUpdateTypes: [type], automerge: true }));
}

const presetsDir = join(here, "..", "presets");
const OWN_PRESET =
  /^(?:local|github)>hugoh\/renovate-config\/\/presets\/([\w-]+)$/;

// Merge the repo's own presets beneath a rule (or preset) that extends them.
// Built-in and external presets are ignored: they don't affect grouping.
function resolveExtends(rule) {
  const { extends: extended = [], ...own } = rule;
  let merged = {};
  for (const name of extended) {
    const match = OWN_PRESET.exec(name);
    if (!match) continue;
    const { $schema, description, ...preset } = JSON.parse(
      readFileSync(join(presetsDir, `${match[1]}.json`), "utf8"),
    );
    merged = { ...merged, ...resolveExtends(preset) };
  }
  return { ...merged, ...own };
}

// Rules inherited through the presets default.json extends come first in
// Renovate's chain, so the generic groups below can override them. Mirror that.
function ownPresetRules(reference) {
  if (reference.startsWith(":automerge")) return builtInRules(reference);
  const match = OWN_PRESET.exec(reference);
  if (!match) return [];
  const preset = JSON.parse(
    readFileSync(join(presetsDir, `${match[1]}.json`), "utf8"),
  );
  return [
    ...(preset.extends ?? []).flatMap(ownPresetRules),
    ...(preset.packageRules ?? []).map(resolveExtends),
  ];
}

const packageRules = [
  ...(config.extends ?? []).flatMap(ownPresetRules),
  ...config.packageRules.map(resolveExtends),
];

const update = (
  packageName,
  datasource,
  updateType,
  manager = "custom.regex",
  depName = packageName,
  packageFile = "mise.toml",
) => ({
  packageRules,
  depName,
  packageName,
  manager,
  datasource,
  updateType,
  packageFile,
  repository: "example/consumer",
});

const cases = [
  // [description, update, expected groupName]
  // jdx/hk and hk-config join the hk group, except jdx/hk in the hk-config
  // repo, where it is part of the project (README: "The hk pins").
  [
    "jdx/hk minor",
    update("jdx/hk", "github-releases", "minor"),
    "hk",
  ],
  [
    "hk-config patch",
    update("hugoh/hk-config", "github-tags", "patch"),
    "hk",
  ],
  [
    "hk-config minor",
    update("hugoh/hk-config", "github-tags", "minor"),
    "hk",
  ],
  [
    "jdx/hk in the hk-config repo is not paired",
    { ...update("jdx/hk", "github-releases", "minor"), repository: "hugoh/hk-config" },
    "dependency updates",
  ],
  [
    "jdx/hk in another repo",
    { ...update("jdx/hk", "github-releases", "minor"), repository: "hugoh/config" },
    "hk",
  ],
  [
    "hk-config major stays ungrouped",
    update("hugoh/hk-config", "github-tags", "major"),
    undefined,
  ],
  // biome is tooling like the rest: its $schema URL (custom.regex) and its
  // mise.toml pin join the generic groups by update type, no group of their own.
  [
    "biome schema patch",
    update("biomejs/biome", "github-releases", "patch"),
    "dependency updates",
  ],
  [
    "biome schema minor",
    update("biomejs/biome", "github-releases", "minor"),
    "dependency updates",
  ],
  [
    "biome mise pin patch",
    update("biomejs/biome", "github-releases", "patch", "mise", "biome"),
    "dependency updates",
  ],
  [
    "biome mise pin minor",
    update("biomejs/biome", "github-releases", "minor", "mise", "biome"),
    "dependency updates",
  ],
  // Linters are tooling like the rest: no group of their own.
  ...["typos", "rumdl", "tombi", "github:owenlamont/ryl", "pypi:ansible-lint"].flatMap(
    (dep) =>
      ["patch", "minor"].map((updateType) => [
        `${dep} ${updateType} in mise.toml`,
        update(dep, dep.startsWith("pypi:") ? "pypi" : "github-releases", updateType, "mise", dep),
        "dependency updates",
      ]),
  ),
  [
    "tooling major update stays ungrouped",
    update("pinact", "github-releases", "major", "mise", "pinact"),
    undefined,
  ],
  [
    "npm:renovate in its own group",
    update("renovate", "npm", "patch", "mise", "npm:renovate"),
    "renovate CLI",
  ],
  // First-party packages get their own group, except the core ones (own
  // group, automerge) and majors (ungrouped, like third-party ones).
  [
    "first-party minor",
    update("hugoh/TeamsControl.spoon", "github-releases", "minor"),
    "first-party updates",
  ],
  [
    "first-party patch",
    update("hugoh/TeamsControl.spoon", "github-releases", "patch"),
    "first-party updates",
  ],
  [
    "first-party major stays ungrouped",
    update("hugoh/TeamsControl.spoon", "github-releases", "major"),
    undefined,
  ],
  [
    "first-party core in an owning repo",
    {
      ...update(
        "hugoh/gh-workflows",
        "github-tags",
        "minor",
        "github-actions",
        "hugoh/gh-workflows",
        ".github/workflows/hk.yml",
      ),
      repository: "hugoh/go-tools",
    },
    "first-party core",
  ],
  [
    "first-party core package in a consumer repo",
    {
      ...update(
        "hugoh/gh-workflows",
        "github-tags",
        "minor",
        "github-actions",
        "hugoh/gh-workflows",
        ".github/workflows/hk.yml",
      ),
      repository: "hugoh/config",
    },
    "first-party updates",
  ],
  // Controls: the generic groups must still apply to everything else.
  [
    "other custom.regex minor",
    update("example/other", "github-releases", "minor"),
    "dependency updates",
  ],
  [
    "other custom.regex patch",
    update("example/other", "github-releases", "patch"),
    "dependency updates",
  ],
];

let failed = false;
for (const [name, input, expected] of cases) {
  const out = await applyPackageRules(input);
  const ok = out.groupName === expected;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: groupName=${out.groupName} (want ${expected})`,
  );
}
// The mise manager looks biome up through github-tags, which finds no updates
// for it (its tags are named @biomejs/biome@<version>), so the CLI pin never
// moved while the npm-tracked $schema did. Both must use the npm datasource.
const overrideCases = [
  ["biome mise pin: npm datasource", update("biomejs/biome", "github-tags", "patch", "mise", "biome"), { datasource: "npm", packageName: "@biomejs/biome" }],
  ["biome schema: npm datasource", update("@biomejs/biome", "npm", "patch", "custom.jsonata", "@biomejs/biome", "biome.json"), { datasource: "npm", packageName: "@biomejs/biome" }],
  ["other mise tool: no override", update("example/other", "github-releases", "patch", "mise", "other"), { datasource: "github-releases", packageName: "example/other" }],
];
for (const [name, input, expected] of overrideCases) {
  const out = await applyPackageRules(input);
  const ok = Object.entries(expected).every(([key, value]) => out[key] === value);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: ${out.datasource} ${out.packageName}`,
  );
}
// Automerge (presets/automerge): tooling merges at every update type, majors
// included; everything else merges minors and patches. A group automerges only
// when every member does, so check that no group mixes the two: record each
// case's group and automerge flag here and in the cases above.
const groups = new Map();
function track(name, out) {
  if (out.groupName === undefined) return;
  const seen = groups.get(out.groupName) ?? new Map();
  seen.set(name, Boolean(out.automerge));
  groups.set(out.groupName, seen);
}
for (const [name, input] of cases) track(name, await applyPackageRules(input));
const gha = (type) => update("actions/checkout", "github-tags", type, "github-actions");
const cargo = (type) => update("tokio", "crate", type, "cargo", "tokio", "Cargo.toml");
const gomod = (type) => update("github.com/x/y", "go", type, "gomod", "github.com/x/y", "go.mod");
const npmDep = (type) => update("he", "npm", type, "npm", "he", "package.json");
const automergeCases = [
  ["pinact major (mise)", update("pinact", "github-releases", "major", "mise", "pinact"), true],
  ["node major (mise)", update("node", "node-version", "major", "mise", "node"), true],
  ["github-actions major", gha("major"), true],
  ["github-actions minor", gha("minor"), true],
  ["copier major", update("https://github.com/hugoh/go-tools.git", "git-tags", "major", "copier", "go-tools", ".copier-answers.yml"), true],
  ["pre-commit major", update("example/hook", "github-tags", "major", "pre-commit", "example/hook", ".pre-commit-config.yaml"), true],
  ["jdx/hk major", update("jdx/hk", "github-releases", "major"), true],
  ["hk-config major", update("hugoh/hk-config", "github-tags", "major"), true],
  ["biome schema major", update("@biomejs/biome", "npm", "major", "custom.jsonata", "@biomejs/biome", "biome.json"), true],
  ["biome mise pin major", update("@biomejs/biome", "npm", "major", "mise", "biome", "mise.toml"), true],
  // :automergeMinor (presets/base) also covers pin and lock file maintenance.
  // Do not drop it as "redundant": nothing else merges these.
  ["lock file maintenance", update("tokio", "crate", "lockFileMaintenance", "cargo", "tokio", "Cargo.lock"), true],
  ["cargo pin", cargo("pin"), true],
  ["cargo patch", cargo("patch"), true],
  ["cargo minor", cargo("minor"), true],
  ["cargo major", cargo("major"), false],
  ["gomod minor", gomod("minor"), true],
  ["gomod major", gomod("major"), false],
  ["npm dependency minor", npmDep("minor"), true],
  ["npm dependency major", npmDep("major"), false],
  ["CDN link (custom.regex) minor", update("example/lib", "npm", "minor", "custom.regex", "example/lib", "index.html"), true],
  ["CDN link (custom.regex) major", update("example/lib", "npm", "major", "custom.regex", "example/lib", "index.html"), false],
  ["first-party minor", update("hugoh/TeamsControl.spoon", "github-releases", "minor"), true],
  ["first-party major", update("hugoh/TeamsControl.spoon", "github-releases", "major"), false],
];
for (const [name, input, expected] of automergeCases) {
  const out = await applyPackageRules(input);
  track(name, out);
  const ok = Boolean(out.automerge) === expected;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} automerge ${name}: ${Boolean(out.automerge)} (want ${expected})`);
}
for (const [group, members] of groups) {
  const ok = new Set(members.values()).size === 1;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} group "${group}" does not mix automerging and manual members${ok ? "" : `: ${JSON.stringify([...members])}`}`,
  );
}
// Soak and timezone come from the shared presets (presets/base and
// presets/first-party-soak); make sure adopting them kept the policy intact.
const base = resolveExtends(config);
const soakCases = [
  ["first-party package: 1 day", "hugoh/some-tool", "github-tags", "1 day"],
  ["hk-config: 7 days, like hk", "hugoh/hk-config", "github-tags", "7 days"],
  ["jdx/hk: 7 days", "jdx/hk", "github-releases", "7 days"],
  ["third-party package: 7 days", "biomejs/biome", "github-releases", "7 days"],
];
for (const [name, packageName, datasource, expected] of soakCases) {
  const out = await applyPackageRules({
    ...update(packageName, datasource, "minor"),
    minimumReleaseAge: base.minimumReleaseAge,
  });
  const ok = out.minimumReleaseAge === expected;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: minimumReleaseAge=${out.minimumReleaseAge} (want ${expected})`,
  );
}
// Minor, patch, pin and digest share the weekend window; major gets no
// rule-level schedule
// and so falls through to the monthly window from presets/base (tooling
// majors excepted, below).
const weekend = resolveExtends({
  extends: ["local>hugoh/renovate-config//presets/weekend"],
}).schedule;
const monthlyWeekend = resolveExtends({
  extends: ["local>hugoh/renovate-config//presets/monthly-weekend"],
}).schedule;
const saturdayEarly = resolveExtends({
  extends: ["local>hugoh/renovate-config//presets/saturday-early"],
}).schedule;
const scheduleCases = [
  ["minor schedule: weekend", update("example/other", "github-releases", "minor"), weekend],
  ["patch schedule: weekend", update("example/other", "github-releases", "patch"), weekend],
  ["major schedule: monthly fallthrough", update("example/other", "github-releases", "major"), undefined],
  // Tooling majors automerge, so they take the weekend window; shipped code's
  // majors (manual) stay on the monthly one.
  ["tool major schedule: weekend (mise)", update("pinact", "github-releases", "major", "mise", "pinact"), weekend],
  ["tool major schedule: weekend (actions)", update("actions/checkout", "github-tags", "major", "github-actions"), weekend],
  ["hk major schedule: weekend", update("jdx/hk", "github-releases", "major"), weekend],
  ["hk-config major schedule: weekend", update("hugoh/hk-config", "github-tags", "major"), weekend],
  ["cargo major schedule: monthly fallthrough", update("tokio", "crate", "major", "cargo", "tokio", "Cargo.toml"), undefined],
  ["linter schedule: weekend", update("typos", "github-releases", "patch", "mise", "typos"), weekend],
  ["npm:renovate schedule: early Saturday", update("renovate", "npm", "patch", "mise", "npm:renovate"), saturdayEarly],
  // Biome is tooling like the rest: weekend for every update type, pin and
  // $schema alike.
  ["biome mise pin schedule: weekend", update("@biomejs/biome", "npm", "patch", "mise", "biome", "mise.toml"), weekend],
  ["biome mise pin minor schedule: weekend", update("@biomejs/biome", "npm", "minor", "mise", "biome", "mise.toml"), weekend],
  ["jdx/hk schedule: weekend", update("jdx/hk", "github-releases", "minor"), weekend],
  ["hk-config patch schedule: weekend", update("hugoh/hk-config", "github-tags", "patch"), weekend],
  ["hk-config minor schedule: weekend", update("hugoh/hk-config", "github-tags", "minor"), weekend],
  ["biome schema schedule: weekend", update("@biomejs/biome", "npm", "minor", "custom.jsonata", "@biomejs/biome", "biome.json"), weekend],
  // Biome is tooling like the rest: weekend for every update type. The group
  // only pairs the pin and the $schema, so they share one window.
  ["biome major schedule: weekend", update("@biomejs/biome", "npm", "major", "mise", "biome", "mise.toml"), weekend],
  ["biome schema major schedule: weekend", update("@biomejs/biome", "npm", "major", "custom.jsonata", "@biomejs/biome", "biome.json"), weekend],
];
for (const [name, input, expected] of scheduleCases) {
  const out = await applyPackageRules(input);
  const ok = JSON.stringify(out.schedule) === JSON.stringify(expected);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: schedule=${JSON.stringify(out.schedule)}`,
  );
}
// hk and hk-config must be bumped together: for every update type and file
// they land in the same group with the same schedule, in any repo but
// hk-config's own (where hk is part of the project, not a linter). A group
// with mixed schedules gets whichever one Renovate meets first, so a split
// here would silently un-bundle them. A consumer overriding the schedule of
// hugoh/** must leave hk-config out ("!hugoh/hk-config"), or it splits them.
for (const repository of ["example/consumer", "hugoh/config", "hugoh/go-tools"]) {
  for (const updateType of ["minor", "patch"]) {
    for (const packageFile of ["hk.pkl", "mise.toml"]) {
      const [hk, hkConfig] = await Promise.all(
        [
          ["jdx/hk", "github-releases"],
          ["hugoh/hk-config", "github-tags"],
        ].map(([name, datasource]) =>
          applyPackageRules({
            ...update(name, datasource, updateType, "custom.regex", name, packageFile),
            repository,
          }),
        ),
      );
      const ok =
        hk.groupName !== undefined &&
        hk.groupName === hkConfig.groupName &&
        JSON.stringify(hk.schedule) === JSON.stringify(hkConfig.schedule);
      if (!ok) failed = true;
      console.log(
        `${ok ? "ok  " : "FAIL"} hk + hk-config bundled: ${repository} ${updateType} ${packageFile}: ${hk.groupName} / ${hkConfig.groupName}`,
      );
    }
  }
}
// The monthly window is one preset: top-level updates and lock file
// maintenance must share it, or majors and lock files land on different days.
for (const [name, actual] of [
  ["base schedule", base.schedule],
  ["lock file maintenance schedule", base.lockFileMaintenance?.schedule],
]) {
  const ok = JSON.stringify(actual) === JSON.stringify(monthlyWeekend);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: monthly-weekend (got ${JSON.stringify(actual)})`,
  );
}
// The first-party core rule only applies where a repo owns the package it
// consumes, so matchPackageNames and matchRepositories must list the same
// repos; otherwise a package is either never fast-laned or fast-laned from a
// repo that doesn't own it.
const core = config.packageRules.find(
  (rule) => rule.groupName === "first-party core",
);
const coreNames = [...(core?.matchPackageNames ?? [])].sort();
const coreRepos = [...(core?.matchRepositories ?? [])].sort();
{
  const ok =
    coreNames.length > 0 &&
    JSON.stringify(coreNames) === JSON.stringify(coreRepos);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} first-party core: matchPackageNames == matchRepositories (names: ${coreNames.join(", ")}; repos: ${coreRepos.join(", ")})`,
  );
}
if (base.osvVulnerabilityAlerts !== true) {
  failed = true;
  console.log(`FAIL osvVulnerabilityAlerts: ${base.osvVulnerabilityAlerts} (want true, from presets/base)`);
} else {
  console.log("ok   osvVulnerabilityAlerts: true");
}
if (base.timezone !== "America/Chicago") {
  failed = true;
  console.log(`FAIL timezone: ${base.timezone} (want America/Chicago)`);
} else {
  console.log("ok   timezone: America/Chicago");
}
if (failed) {
  console.error(
    "\nThe renovate CLI rule in default.json must stay below the generic dependency updates rule.",
  );
  process.exit(1);
}
