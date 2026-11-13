// scripts/__tests__/theme-digest.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  mergeKnownDigests,
  normalize,
  serializeKnownDigests,
  themeDigest,
  updateKnownBuiltinDigests,
} from "../theme-digest";

const utf8 = (text: string) => new TextEncoder().encode(text);

function tempDigestFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voxis-theme-digest-"));
  return path.join(dir, "known-builtin-digests.json");
}

describe("themeDigest", () => {
  it("matches the fixed vector of the Rust implementation", () => {
    // Same input and same expected hex as
    // `test_theme_digest_matches_a_hand_computed_sha256` in
    // `src-tauri/src/theme_engine/digest.rs`: the cross-language agreement
    // check. The hex was derived from the spec, not from either implementation:
    //   printf 'theme.js\00023\000exportfunctionmount(){}theme.json\00010\000{"id":"x"}' | sha256sum
    const files = [
      { name: "theme.json", bytes: utf8('{\n  "id": "x"\n}\n') },
      { name: "theme.js", bytes: utf8("export function mount() {\n}\n") },
    ];
    expect(themeDigest(files)).toBe(
      "0730e9266181a6394469e07f5270e096d5f1d14cb1fb5bc28f3cf740bd64b68a",
    );
  });

  it("ignores whitespace-only differences but nothing else", () => {
    const shipped = [{ name: "theme.js", bytes: utf8("try { mount(); } catch {\n    }\n") }];
    const fromGit = [{ name: "theme.js", bytes: utf8("try { mount(); } catch {} ") }];
    expect(shipped[0].bytes).not.toEqual(fromGit[0].bytes);
    expect(themeDigest(shipped)).toBe(themeDigest(fromGit));

    expect(themeDigest(fromGit)).not.toBe(
      themeDigest([{ name: "theme.js", bytes: utf8("try { mount(); } catch {;}") }]),
    );
  });

  it("strips exactly the six ASCII whitespace bytes the spec lists", () => {
    const all = utf8("a b\tc\nd\re\x0bf\x0cg");
    expect(Array.from(normalize(all))).toEqual(Array.from(utf8("abcdefg")));
    // Non-whitespace control bytes and UTF-8 continuation bytes stay.
    const other = utf8("\x00\x7f\u00e9");
    expect(Array.from(normalize(other))).toEqual(Array.from(other));
  });

  it("is independent of the order the files arrive in", () => {
    const files = [
      { name: "theme.json", bytes: utf8('{"id":"x"}') },
      { name: "theme.js", bytes: utf8("export function mount(){}") },
      { name: "extra.css", bytes: utf8("body{}") },
    ];
    expect(themeDigest([...files].reverse())).toBe(themeDigest(files));
  });
});

describe("known-builtin-digests.json", () => {
  it("merges append-only: a theme that is gone keeps its digests", () => {
    const removed = { retired_orb: ["aa", "bb"] };
    const merged = mergeKnownDigests(removed, { retired_orb: ["bb"], winamp_classic: ["cc"] });
    expect(serializeKnownDigests(merged)).toBe(
      [
        "{",
        '  "retired_orb": [',
        '    "aa",',
        '    "bb"',
        "  ],",
        '  "winamp_classic": [',
        '    "cc"',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("is deterministic: a second identical run rewrites nothing", () => {
    const file = tempDigestFile();
    const digests = { all_aquarium: ["a1"], default: ["d1", "d0", "d1"] };

    expect(updateKnownBuiltinDigests(file, digests)).toBe(true);
    const first = fs.readFileSync(file, "utf8");
    // ids sorted, digests sorted and deduplicated, 2-space JSON, trailing newline.
    expect(first).toBe(
      [
        "{",
        '  "all_aquarium": [',
        '    "a1"',
        "  ],",
        '  "default": [',
        '    "d0",',
        '    "d1"',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );

    // Same set again, plus a digest already present: content is unchanged, so
    // the file is not written (no mtime churn).
    expect(updateKnownBuiltinDigests(file, digests)).toBe(false);
    expect(updateKnownBuiltinDigests(file, { all_aquarium: ["a1"] })).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(first);

    // A new digest is appended, the old ones stay.
    expect(updateKnownBuiltinDigests(file, { all_aquarium: ["a2"] })).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      all_aquarium: ["a1", "a2"],
      default: ["d0", "d1"],
    });
  });

  it("creates the list when it does not exist yet", () => {
    const file = tempDigestFile();
    expect(fs.existsSync(file)).toBe(false);
    updateKnownBuiltinDigests(file, { default: ["d1"] });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ default: ["d1"] });
  });
});
