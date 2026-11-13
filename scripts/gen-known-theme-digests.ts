// scripts/gen-known-theme-digests.ts
/**
 * One-off generator for `src-tauri/known-builtin-digests.json`: the digest of
 * every builtin theme folder that ever shipped with a v2 manifest, so the app
 * can tell an untouched copy of a builtin (safe to move aside, see the
 * `retire_pristine_copies` migration) from a user edit (kept, shadows the
 * builtin).
 *
 * The digest spec itself lives in `scripts/theme-digest.ts` (the one TS
 * implementation, shared with `scripts/build-themes.ts`), which states the
 * identical spec to `src-tauri/src/theme_engine/digest.rs`; the Rust test
 * `test_theme_digest_of_every_bundled_theme_is_known` cross-checks the Rust
 * digest of the current bundle against this file.
 *
 * The list is merged append-only into whatever is already committed (see
 * `updateKnownBuiltinDigests`), so a digest that ever shipped is never lost.
 *
 * The walk starts at `4c3f98e` (the v2 manifest + seeder, 2026-06-10): older
 * copies were v1, which the scanner never loads, so their digests are useless
 * and would only keep dead data alive. Every `v0.1.*` release tag's own
 * `src-tauri/themes` tree is added as well, so what shipped from a tag is
 * covered by content, not merely by ancestry.
 *
 * Run from the repo root: `bun scripts/gen-known-theme-digests.ts`.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  KNOWN_DIGESTS_FILE,
  type KnownDigests,
  normalize,
  themeDigest,
  updateKnownBuiltinDigests,
} from "./theme-digest";

const REPO_ROOT = process.cwd();
const THEMES_DIR = "src-tauri/themes";
/** Commit that introduced the v2 manifest and the seeder it fed. */
const RANGE_BASE = "4c3f98e";

type ThemeFile = { themeId: string; name: string; blobSha: string };

function git(args: string[]): Buffer {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout;
}

function gitText(args: string[]): string {
  return git(args).toString("utf8");
}

function gitOk(args: string[]): boolean {
  return spawnSync("git", args, { cwd: REPO_ROOT, stdio: "ignore" }).status === 0;
}

if (!fs.existsSync(path.join(REPO_ROOT, THEMES_DIR))) {
  throw new Error(`run me from the repo root: ${THEMES_DIR} not found in ${REPO_ROOT}`);
}

/** The regular blobs of every theme folder at `commit`. */
function themeFiles(commit: string): ThemeFile[] {
  const prefix = `${THEMES_DIR}/`;
  const files: ThemeFile[] = [];
  const records = gitText([
    "ls-tree",
    "-r",
    "-z",
    commit,
    "--",
    `${THEMES_DIR}/`,
  ]).split("\0");
  for (const record of records) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, blobSha] = record.slice(0, tab).split(" ");
    if (type !== "blob") continue;
    // Regular/executable files only: this drops symlinks (120000) and
    // gitlinks (160000), the way `ThemeSource::files` drops non-files.
    if (mode !== "100644" && mode !== "100755") continue;
    const filePath = record.slice(tab + 1);
    if (!filePath.startsWith(prefix)) continue;
    const [themeId, name, ...rest] = filePath.slice(prefix.length).split("/");
    // A file directly under `themes/` (no theme folder) or in a subdirectory
    // of a theme folder is not part of the digest input.
    if (!themeId || !name || rest.length > 0) continue;
    files.push({ themeId, name, blobSha });
  }
  return files;
}

const blobCache = new Map<string, Uint8Array>();
const digestCache = new Map<string, string>();

/** Normalized bytes of one git blob — the only form the digest ever needs. */
function blobBytes(blobSha: string): Uint8Array {
  const cached = blobCache.get(blobSha);
  if (cached) return cached;
  const bytes = normalize(git(["cat-file", "blob", blobSha]));
  blobCache.set(blobSha, bytes);
  return bytes;
}

function sortByName(files: ThemeFile[]): ThemeFile[] {
  return [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Digest of one theme folder; memoized by the folder's content signature. */
function folderDigest(files: ThemeFile[]): string {
  const sorted = sortByName(files);
  const signature = sorted.map((f) => `${f.name}\0${f.blobSha}`).join("\n");
  const cached = digestCache.get(signature);
  if (cached) return cached;
  const digest = themeDigest(
    sorted.map((file) => ({ name: file.name, bytes: blobBytes(file.blobSha) })),
  );
  digestCache.set(signature, digest);
  return digest;
}

const known = new Map<string, Set<string>>();

/**
 * Add the digests of every theme folder present at `commit`. Returns the
 * number of theme-folder instances seen (duplicates included), so the log
 * shows how much history was actually read.
 */
function addCommit(commit: string): number {
  const byTheme = new Map<string, ThemeFile[]>();
  for (const file of themeFiles(commit)) {
    const files = byTheme.get(file.themeId);
    if (files) files.push(file);
    else byTheme.set(file.themeId, [file]);
  }
  let added = 0;
  for (const [themeId, files] of byTheme) {
    let digests = known.get(themeId);
    if (!digests) {
      digests = new Set();
      known.set(themeId, digests);
    }
    digests.add(folderDigest(files));
    added++;
  }
  return added;
}

const rangeBase = gitOk(["rev-parse", "--verify", "--quiet", `${RANGE_BASE}^`])
  ? `${RANGE_BASE}^`
  : RANGE_BASE;
const baseCommit = gitText(["rev-parse", rangeBase]).trim();
// `--full-history`: no history simplification, every commit that touched the
// themes directory is walked even across merges.
const commits = gitText([
  "rev-list",
  "--full-history",
  `${rangeBase}..HEAD`,
  "--",
  THEMES_DIR,
])
  .split("\n")
  .filter(Boolean);

let instances = 0;
for (const commit of commits) instances += addCommit(commit);

// Every release tag's own `src-tauri/themes` tree is added too, so a copy
// seeded from that exact release matches even when the tag's tree differs from
// every walked commit (a tag commit that does not touch the themes directory
// is not in the walk). The per-tag line logged below is the ancestry check
// only — the tag's digests are added either way.
const head = gitText(["rev-parse", "HEAD"]).trim();
const isAncestor = (a: string, b: string) =>
  gitOk(["merge-base", "--is-ancestor", a, b]);
const tags = gitText(["tag", "-l", "v0.1.*"])
  .split("\n")
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

const uncovered: string[] = [];
for (const tag of tags) {
  const commit = gitText(["rev-list", "-n", "1", tag]).trim();
  const tagInstances = addCommit(commit);
  instances += tagInstances;
  const covered = isAncestor(baseCommit, commit) && isAncestor(commit, head);
  if (!covered) uncovered.push(tag);
  console.log(
    `  ${covered ? "in range    " : "OUT of range"} ${tag} (${commit.slice(0, 7)}): ` +
      `added ${tagInstances} theme digests`,
  );
}

const derived: KnownDigests = {};
for (const [themeId, digests] of known) derived[themeId] = [...digests];
const outFile = path.join(REPO_ROOT, KNOWN_DIGESTS_FILE);
const written = updateKnownBuiltinDigests(outFile, derived);
const out = JSON.parse(fs.readFileSync(outFile, "utf8")) as KnownDigests;

const ids = Object.keys(out);
const digests = ids.reduce((sum, id) => sum + out[id].length, 0);
console.log(
  `${commits.length} commits walked (${rangeBase}..HEAD) in ${THEMES_DIR}: ` +
    `${instances} theme-folder instances (incl. tag trees) -> ${ids.length} ids, ${digests} digests`,
);
console.log(written ? `wrote ${KNOWN_DIGESTS_FILE}` : `${KNOWN_DIGESTS_FILE} already up to date`);
console.log(
  uncovered.length === 0
    ? `all ${tags.length} v0.1.* release tags are in the walked range; their digests are included`
    : `${uncovered.length}/${tags.length} release tags outside the walked range (digests still added): ${uncovered.join(", ")}`,
);
