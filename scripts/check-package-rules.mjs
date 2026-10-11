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
// Offline and fast: it only evaluates default.json's own rules. The rule
// order inside default.json is what decides the outcome, because rules that
// come in through `extends` (hk-config's managers) are applied before them.
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

const packageRules = config.packageRules.map(resolveExtends);

const update = (
  packageName,
  datasource,
  updateType,
  manager = "custom.regex",
  depName = packageName,
) => ({
  packageRules,
  depName,
  packageName,
  manager,
  datasource,
  updateType,
});

const cases = [
  // [description, update, expected groupName]
  // The hk pins land in the generic groups: hk-config only needs
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
    "patch updates",
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
const scheduleCases = [
  ["minor schedule: weekend", "minor", weekend],
  ["patch schedule: weekend", "patch", weekend],
  ["major schedule: monthly fallthrough", "major", undefined],
];
for (const [name, updateType, expected] of scheduleCases) {
  const out = await applyPackageRules(
    update("example/other", "github-releases", updateType),
  );
  const ok = JSON.stringify(out.schedule) === JSON.stringify(expected);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: schedule=${JSON.stringify(out.schedule)}`,
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
