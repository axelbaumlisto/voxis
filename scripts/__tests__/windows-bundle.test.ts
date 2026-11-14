// scripts/__tests__/windows-bundle.test.ts
//
// Guard for the Windows app-local VC++ runtime (v0.1.22): `voice.exe` imports
// MSVCP140.dll / MSVCP140_1.dll (ONNX Runtime via `ort`) and a clean Windows has
// none of them, so the NSIS installer MUST carry the four DLLs. See
// `src-tauri/windows/vc-runtime/README.md` for the whole story.
//
// Why a test: the platform config is merged into `tauri.conf.json` with JSON
// Merge Patch (RFC 7396), where an OBJECT replaces an ARRAY — so the moment
// `bundle.resources` becomes a map in `tauri.windows.conf.json`, every resource
// missing from that map is silently dropped from the Windows bundle (that is
// `resources/silero_vad_v4.onnx`, i.e. VAD). Nothing else fails: the app just
// starts without the runtime DLLs or without its VAD model.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const TAURI_DIR = path.join(__dirname, "../../src-tauri");
const windowsConf = JSON.parse(
  fs.readFileSync(path.join(TAURI_DIR, "tauri.windows.conf.json"), "utf8"),
);
const baseConf = JSON.parse(fs.readFileSync(path.join(TAURI_DIR, "tauri.conf.json"), "utf8"));

// SHA-256 of each DLL as shipped from Microsoft's vc_redist.x64.exe
// 14.44.35211.0 — the same table the README documents.
const VC_RUNTIME: Record<string, string> = {
  "msvcp140.dll": "0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9",
  "msvcp140_1.dll": "bfad5aef4c63a669e3c140655cdfdf395b6c979b400a447bd5dcb65ed8826c3d",
  "vcruntime140.dll": "d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066",
  "vcruntime140_1.dll": "1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f",
};

const resources: Record<string, string> = windowsConf.bundle.resources;

describe("tauri.windows.conf.json bundle resources", () => {
  it("uses the object form, which is what puts files in $INSTDIR", () => {
    // Array form would keep the source path (`windows/vc-runtime/msvcp140.dll`
    // -> `$INSTDIR\windows\vc-runtime\msvcp140.dll`), where the loader does not
    // look.
    expect(Array.isArray(resources)).toBe(false);
    expect(typeof resources).toBe("object");
  });

  it("keeps the Silero VAD model (the merge-patch trap)", () => {
    expect(resources["resources/silero_vad_v4.onnx"]).toBe("resources/silero_vad_v4.onnx");
    // And the base config still lists it, so Linux/macOS bundles keep it.
    expect(baseConf.bundle.resources).toContain("resources/silero_vad_v4.onnx");
  });

  it.each(Object.keys(VC_RUNTIME))("ships %s next to voice.exe", (dll) => {
    expect(resources[`windows/vc-runtime/${dll}`]).toBe(dll);
  });

  it("ships the exact Microsoft DLL bytes the README documents", () => {
    for (const [dll, sha256] of Object.entries(VC_RUNTIME)) {
      const bytes = fs.readFileSync(path.join(TAURI_DIR, "windows/vc-runtime", dll));
      expect(createHash("sha256").update(bytes).digest("hex"), dll).toBe(sha256);
    }
  });
});
