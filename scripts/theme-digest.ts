// scripts/theme-digest.ts
/**
 * Theme digest — the fingerprint of one theme folder's regular files — plus the
 * append-only updater for `src-tauri/known-builtin-digests.json` (every digest
 * a builtin theme ever shipped with, so the app can tell an untouched copy of a
 * builtin — safe to move aside, see the `retire_pristine_copies` migration —
 * from a user edit — kept, shadows the builtin).
 *
 * SPEC (identical in `src-tauri/src/theme_engine/digest.rs`, the Rust
 * counterpart; that module's `test_theme_digest_matches_a_hand_computed_sha256`
 * and this module's fixed-vector test assert the same input and hex, so the two
 * implementations are cross-checked against each other):
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
 * Two consumers, one implementation: `scripts/gen-known-theme-digests.ts`
 * derives the list from the git history of `src-tauri/themes`, and
 * `scripts/build-themes.ts` appends the digest of what it has just bundled.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";

/** Repo-relative path of the known-digest list both scripts maintain. */
export const KNOWN_DIGESTS_FILE = "src-tauri/known-builtin-digests.json";

/** `known-builtin-digests.json`: theme id -> every digest it ever shipped with. */
export type KnownDigests = Record<string, string[]>;

/** The ASCII whitespace bytes the spec removes: space, tab, LF, CR, VT, FF. */
const ASCII_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);

/**
 * Point 2 of the spec: every ASCII whitespace byte removed, nothing else.
 * Idempotent, so passing already-normalized bytes is fine.
 */
export function normalize(bytes: Uint8Array): Uint8Array {
  return bytes.filter((byte) => !ASCII_WHITESPACE.has(byte));
}

/** Digest of one theme folder per the module spec. */
export function themeDigest(files: { name: string; bytes: Uint8Array }[]): string {
  // Point 3. `<` on strings compares UTF-16 code units == bytes for ASCII,
  // which is all theme file names are.
  const sorted = [...files].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const file of sorted) {
    const bytes = normalize(file.bytes);
    hash.update(Buffer.from(file.name, "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(String(bytes.length), "ascii"));
    hash.update(Buffer.from([0]));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/** The serialization both scripts write: ids sorted, digests sorted, 2-space, newline. */
export function serializeKnownDigests(known: KnownDigests): string {
  const out: KnownDigests = {};
  for (const id of Object.keys(known).sort()) out[id] = [...new Set(known[id])].sort();
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Append-only merge: nothing from `existing` is dropped, `added` only grows it. */
export function mergeKnownDigests(existing: KnownDigests, added: KnownDigests): KnownDigests {
  const merged: KnownDigests = {};
  for (const source of [existing, added]) {
    for (const [id, digests] of Object.entries(source)) {
      merged[id] = [...(merged[id] ?? []), ...digests];
    }
  }
  return merged;
}

/**
 * Merge `added` into the known-digest list at `filePath` (a missing file counts
 * as empty, so the first run creates it) and write it back only when the
 * serialized content changed — re-running never churns the file's mtime.
 * Returns whether it wrote.
 */
export function updateKnownBuiltinDigests(filePath: string, added: KnownDigests): boolean {
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  const existing: KnownDigests = raw === null ? {} : (JSON.parse(raw) as KnownDigests);
  const content = serializeKnownDigests(mergeKnownDigests(existing, added));
  if (raw === content) return false;
  fs.writeFileSync(filePath, content);
  return true;
}
