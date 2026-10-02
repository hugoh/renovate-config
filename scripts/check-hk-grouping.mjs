#!/usr/bin/env node
// Regression check for the "hk toolchain" group (see README: "Rule order
// matters"). Runs default.json's packageRules through Renovate's own rule
// matcher for synthetic updates and fails if the jdx/hk and hugoh/hk-config
// pins stop landing in one group — e.g. when a generic "minor updates" /
// "patch updates" rule gets placed after the hk toolchain rule and replaces
// its groupName.
//
// Presets under presets/ that a rule extends (e.g. presets/hk-toolchain, which
// carries the group name, soak and schedule) are resolved from this checkout,
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

const update = (packageName, datasource, updateType) => ({
  packageRules,
  depName: packageName,
  packageName,
  manager: "custom.regex",
  datasource,
  updateType,
});

const cases = [
  // [description, update, expected groupName]
  [
    "jdx/hk minor",
    update("jdx/hk", "github-releases", "minor"),
    "hk toolchain",
  ],
  [
    "jdx/hk patch",
    update("jdx/hk", "github-releases", "patch"),
    "hk toolchain",
  ],
  [
    "hk-config minor",
    update("hugoh/hk-config", "github-tags", "minor"),
    "hk toolchain",
  ],
  [
    "hk-config patch",
    update("hugoh/hk-config", "github-tags", "patch"),
    "hk toolchain",
  ],
  // Controls: the generic groups must still apply to everything else.
  [
    "other custom.regex minor",
    update("biomejs/biome", "github-releases", "minor"),
    "minor updates",
  ],
  [
    "other custom.regex patch",
    update("biomejs/biome", "github-releases", "patch"),
    "patch updates",
  ],
];

let failed = false;
const ages = new Set();
const schedules = new Set();
for (const [name, input, expected] of cases) {
  const out = await applyPackageRules(input);
  const ok = out.groupName === expected;
  if (!ok) failed = true;
  if (expected === "hk toolchain") {
    ages.add(out.minimumReleaseAge);
    schedules.add(JSON.stringify(out.schedule));
  }
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: groupName=${out.groupName} (want ${expected})`,
  );
}
if (ages.size !== 1 || ages.has(undefined)) {
  failed = true;
  console.log(
    `FAIL hk toolchain members must share one minimumReleaseAge, got: ${[...ages].join(", ")}`,
  );
}
if (schedules.size !== 1 || schedules.has(undefined)) {
  failed = true;
  console.log(
    `FAIL hk toolchain members must share one schedule, got: ${[...schedules].join(", ")}`,
  );
}
if (failed) {
  console.error(
    "\nThe hk toolchain rule in default.json must stay below the generic minor/patch grouping rules.",
  );
  process.exit(1);
}
