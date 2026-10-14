#!/usr/bin/env node
// Regression check for default.json's packageRules (see README: "Rule order
// matters"). Runs them through Renovate's own rule matcher for synthetic
// updates and fails if the policy changes: the biome toolchain group (which
// must stay below the generic "minor updates" / "patch updates" rules, or
// their groupName replaces it), the generic groups themselves, the
// first-party / third-party soak, and the schedules.
//
// Presets under presets/ that a rule extends are resolved from this checkout,
// the way Renovate merges them beneath the rule's own settings.
//
// It also checks that the `linters` rule covers every tool hk-config's
// `stepTools` (base.pkl) maps a step to, so the two can't drift apart. That
// reads the hk-config version pinned in hk.pkl through `pkl`; set
// HK_CONFIG_BASE_PKL to a local base.pkl to check an unreleased hk-config.
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

const rules = join(findRenovate(), "dist", "util", "package-rules", "index.js");
const { applyPackageRules } = await import(rules);

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
});

const cases = [
  // [description, update, expected groupName]
  // The hk pins land in the generic groups (hk-config, being first-party, in
  // its own group): hk-config only needs
  // hk >= its min_hk_version, which hk enforces itself, so they don't need to
  // move together (README: "The hk pins").
  [
    "jdx/hk minor",
    update("jdx/hk", "github-releases", "minor"),
    "minor updates",
  ],
  [
    "hk-config patch",
    update("hugoh/hk-config", "github-tags", "patch"),
    "first-party updates",
  ],
  // biome: the $schema URL (custom.regex) and the mise.toml pin (mise) must
  // land in one group, or the CLI drifts from the schema.
  [
    "biome schema patch",
    update("biomejs/biome", "github-releases", "patch"),
    "biome toolchain",
  ],
  [
    "biome schema minor",
    update("biomejs/biome", "github-releases", "minor"),
    "biome toolchain",
  ],
  [
    "biome mise pin patch",
    update("biomejs/biome", "github-releases", "patch", "mise", "biome"),
    "biome toolchain",
  ],
  [
    "biome mise pin minor",
    update("biomejs/biome", "github-releases", "minor", "mise", "biome"),
    "biome toolchain",
  ],
  // Linters in the repo's own mise.toml move in their own monthly group; the
  // same tools in other files (config's global tools) stay in the weekly ones.
  ...[
    ["typos", "github-releases"],
    ["rumdl", "github-releases"],
    ["tombi", "github-releases"],
    ["github:owenlamont/ryl", "github-releases"],
    ["aqua:Kampfkarren/selene", "github-releases"],
  ].flatMap(([dep, datasource]) =>
    ["patch", "minor"].map((updateType) => [
      `${dep} ${updateType} in mise.toml`,
      update(dep, datasource, updateType, "mise", dep),
      "linters",
    ]),
  ),
  [
    "linter in a global tools file",
    update(
      "ruff",
      "github-releases",
      "patch",
      "mise",
      "ruff",
      "dotfiles/dot_config/mise/exact_conf.d/10-tools.toml.tmpl",
    ),
    "patch updates",
  ],
  [
    "non-linter mise tool",
    update("uv", "github-releases", "patch", "mise", "uv"),
    "patch updates",
  ],
  [
    "linter major update stays ungrouped",
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
    "minor updates",
  ],
  [
    "other custom.regex patch",
    update("example/other", "github-releases", "patch"),
    "patch updates",
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
// Soak and timezone come from the shared presets (presets/base and
// presets/first-party-soak); make sure adopting them kept the policy intact.
const base = resolveExtends(config);
const soakCases = [
  ["first-party package: 1 day", "hugoh/some-tool", "github-tags", "1 day"],
  ["hk-config: 1 day", "hugoh/hk-config", "github-tags", "1 day"],
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
// Minor and patch share the weekend window; major gets no rule-level schedule
// and so falls through to the monthly window from presets/base.
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
  ["linters schedule: first weekend", update("typos", "github-releases", "patch", "mise", "typos"), monthlyWeekend],
  ["npm:renovate schedule: early Saturday", update("renovate", "npm", "patch", "mise", "npm:renovate"), saturdayEarly],
  // The biome toolchain is a linter too: pin and $schema share one group, so
  // they must share its window. Majors are included, they don't fall through.
  ["biome mise pin schedule: first weekend", update("@biomejs/biome", "npm", "patch", "mise", "biome", "mise.toml"), monthlyWeekend],
  ["biome mise pin minor schedule: first weekend", update("@biomejs/biome", "npm", "minor", "mise", "biome", "mise.toml"), monthlyWeekend],
  ["biome schema schedule: first weekend", update("@biomejs/biome", "npm", "minor", "custom.jsonata", "@biomejs/biome", "biome.json"), monthlyWeekend],
  ["biome major schedule: first weekend", update("@biomejs/biome", "npm", "major", "mise", "biome", "mise.toml"), monthlyWeekend],
];
for (const [name, input, expected] of scheduleCases) {
  const out = await applyPackageRules(input);
  const ok = JSON.stringify(out.schedule) === JSON.stringify(expected);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: schedule=${JSON.stringify(out.schedule)}`,
  );
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
// The linters rule lists the tools behind hk-config's steps. Tools that are
// deliberately not in it must say why; a tool in neither place is a new step
// nobody classified, and a listed tool hk-config no longer runs is stale.
const EXCLUDED = {
  biome: "own group (biome toolchain)",
  "npm:renovate": "own group (renovate CLI)",
  tofu: "infrastructure tool, not a linter",
  trivy: "security scanner, stays on the weekly groups",
};
const REPO_LOCAL = new Set(["editorconfig-checker"]);

function stepTools() {
  const source = process.env.HK_CONFIG_BASE_PKL;
  const [expression, file] = source
    ? ["stepTools", resolve(source)]
    : ["Base.stepTools", join(here, "..", "hk.pkl")];
  const json = `new JsonRenderer {}.renderValue(${expression})`;
  try {
    return JSON.parse(
      execFileSync("pkl", ["eval", "-x", json, "-f", "plain", file], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    throw new Error(
      `cannot read stepTools from ${file}: bump the hk-config pin in hk.pkl to a release that has it, or set HK_CONFIG_BASE_PKL\n${error.stderr ?? error.message}`,
    );
  }
}

const linters = new Set(
  config.packageRules.find((rule) => rule.groupName === "linters")
    ?.matchDepNames ?? [],
);
const hkTools = new Set(Object.values(stepTools()).filter(Boolean));
const coverage = [
  ["unclassified hk-config tools", [...hkTools].filter((t) => !linters.has(t) && !(t in EXCLUDED))],
  ["linters entries hk-config no longer runs", [...linters].filter((t) => !hkTools.has(t) && !REPO_LOCAL.has(t))],
  ["excluded tools that are also listed", Object.keys(EXCLUDED).filter((t) => linters.has(t))],
  ["excluded tools hk-config no longer runs", Object.keys(EXCLUDED).filter((t) => !hkTools.has(t))],
];
for (const [name, tools] of coverage) {
  const ok = tools.length === 0;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${tools.join(", ") || "none"}`);
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
if (base.timezone !== "America/Chicago") {
  failed = true;
  console.log(`FAIL timezone: ${base.timezone} (want America/Chicago)`);
} else {
  console.log("ok   timezone: America/Chicago");
}
if (failed) {
  console.error(
    "\nThe biome toolchain rule in default.json must stay below the generic minor/patch grouping rules.",
  );
  process.exit(1);
}
