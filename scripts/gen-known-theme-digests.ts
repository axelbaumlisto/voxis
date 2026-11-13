// scripts/gen-known-theme-digests.ts
/**
 * One-off generator for `src-tauri/known-builtin-digests.json`: the digest of
 * every builtin theme folder that ever shipped with a v2 manifest, so the app
 * can tell an untouched copy of a builtin (safe to move aside, see the
 * `retire_pristine_copies` migration) from a user edit (kept, shadows the
 * builtin).
 *
 * DIGEST SPEC — identical to `src-tauri/src/theme_engine/digest.rs`, which
 * must agree with this file byte for byte (`test_theme_digest_of_every_bundled_theme_is_known`
 * cross-checks the Rust digest of the current bundle against this file):
 *
 * 1. input: the theme folder's **regular** files — no symlinks, no
 *    subdirectories — as `(file name, bytes)`;
 * 2. normalize each file's bytes: remove **every** ASCII whitespace byte —
 *    space `0x20`, tab `0x09`, LF `0x0A`, CR `0x0D`, VT `0x0B`, FF `0x0C`;
 *    release builds re-bundle the themes with a different bun that formats
 *    differently (`} catch {\n    }` vs `} catch {}`), so a **shipped** copy
 *    of a theme differs from its git blob in whitespace only. Canonical JSON
 *    is not an option (Rust and JS print numbers differently, `1.0` vs `1`),
 *    and the rule is applied to every file, whatever its extension;
 * 3. sort by file name, byte-wise (`String::cmp` == JS's default `Array.sort`
 *    on ASCII names; all theme file names are ASCII);
 * 4. sha256 over the concatenation, per file, of: the name bytes, `0x00`,
 *    the decimal byte length of the **normalized** content as ASCII, `0x00`,
 *    the **normalized** bytes;
 * 5. digest = the lowercase hex encoding of that sha256.
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
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = process.cwd();
const THEMES_DIR = "src-tauri/themes";
const OUT_FILE = "src-tauri/known-builtin-digests.json";
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

/** The ASCII whitespace bytes the spec removes. */
const ASCII_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);

function normalize(bytes: Buffer): Buffer {
  return Buffer.from(bytes.filter((byte) => !ASCII_WHITESPACE.has(byte)));
}

const blobCache = new Map<string, Buffer>();
const chunkCache = new Map<string, Buffer>();
const digestCache = new Map<string, string>();

/** `name`, NUL, decimal length, NUL, normalized bytes — the digest input. */
function fileChunk(blobSha: string, name: string): Buffer {
  const key = `${blobSha}\0${name}`;
  const cached = chunkCache.get(key);
  if (cached) return cached;
  let bytes = blobCache.get(blobSha);
  if (!bytes) {
    // Normalized once per blob: it is the only form the digest ever needs.
    bytes = normalize(git(["cat-file", "blob", blobSha]));
    blobCache.set(blobSha, bytes);
  }
  const chunk = Buffer.concat([
    Buffer.from(name, "utf8"),
    Buffer.from([0]),
    Buffer.from(String(bytes.length), "ascii"),
    Buffer.from([0]),
    bytes,
  ]);
  chunkCache.set(key, chunk);
  return chunk;
}

function sortByName(files: ThemeFile[]): ThemeFile[] {
  return [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Digest of one theme folder; memoized by the folder's content signature. */
function themeDigest(files: ThemeFile[]): string {
  const sorted = sortByName(files);
  const signature = sorted.map((f) => `${f.name}\0${f.blobSha}`).join("\n");
  const cached = digestCache.get(signature);
  if (cached) return cached;
  const hash = createHash("sha256");
  for (const file of sorted) hash.update(fileChunk(file.blobSha, file.name));
  const digest = hash.digest("hex");
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
    digests.add(themeDigest(files));
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

const out: Record<string, string[]> = {};
for (const themeId of [...known.keys()].sort()) {
  out[themeId] = [...known.get(themeId)!].sort();
}
fs.writeFileSync(
  path.join(REPO_ROOT, OUT_FILE),
  `${JSON.stringify(out, null, 2)}\n`,
);

const ids = Object.keys(out);
const digests = ids.reduce((sum, id) => sum + out[id].length, 0);
console.log(
  `${commits.length} commits walked (${rangeBase}..HEAD) in ${THEMES_DIR}: ` +
    `${instances} theme-folder instances (incl. tag trees) -> ${ids.length} ids, ${digests} digests`,
);
console.log(`wrote ${OUT_FILE}`);
console.log(
  uncovered.length === 0
    ? `all ${tags.length} v0.1.* release tags are in the walked range; their digests are included`
    : `${uncovered.length}/${tags.length} release tags outside the walked range (digests still added): ${uncovered.join(", ")}`,
);
