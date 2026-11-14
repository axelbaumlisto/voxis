# Microsoft Visual C++ runtime (x64) shipped with the Windows build

Four unmodified DLLs from Microsoft's official **Microsoft Visual C++ 2015–2022
Redistributable (x64)** package, committed here because the Windows app cannot
start without them and `src-tauri/tauri.windows.conf.json` bundles them next to
`voice.exe`.

## Why

`voice.exe` links `ort` (ONNX Runtime, via `vad-rs` for Silero VAD), and ONNX
Runtime is a C++ library built with the dynamic C runtime (`/MD`):

```console
$ objdump -p voxis-windows-x64-gui.exe | grep -iE 'DLL Name: (MSVCP|VCRUNTIME)'
        DLL Name: MSVCP140_1.dll
        DLL Name: MSVCP140.dll
$ objdump -p src-tauri/windows/vc-runtime/msvcp140.dll | grep -i 'VCRUNTIME'
        DLL Name: VCRUNTIME140_1.dll
        DLL Name: VCRUNTIME140.dll
```

So the exe imports `MSVCP140{,_1}.dll`, and those import `VCRUNTIME140{,_1}.dll`
(the `api-ms-win-crt-*` imports are the Universal CRT that ships with Windows
10+). A clean Windows 11 (no Visual Studio, no VC++ Redistributable ever installed) has none
of the four, so the loader fails before `main` — the process exits with
`0xC0000135 STATUS_DLL_NOT_FOUND`, even for `voice.exe --version` (observed on a
clean Windows 11 25H2 VM with v0.1.21). Copying these four DLLs next to the exe
fixed it (`--version` → `voxis 0.1.21`, setup ran, overlay theme `default`).

`pyke`/`ort` publish no static-CRT Windows build, so this cannot be fixed by a
feature flag on the Rust side. Tauri's own `bundle > windows > bundleVCRuntime`
option is not usable here: it wants a Visual Studio redist tree (or
`VCTOOLS_REDIST_DIR` laid out as `VC/Redist/MSVC/<version>/x64`) and copies every
DLL it finds, which the Linux `cargo-xwin` cross-build container does not have.
Committing exactly the four needed DLLs keeps the installer/portable zip
reproducible.

## What is here

Source: <https://aka.ms/vs/17/release/vc_redist.x64.exe>
(`vc_redist.x64.exe`, version **14.44.35211.0**), extracted 2026-11-14.

| File | Size | SHA-256 |
| --- | --- | --- |
| `msvcp140.dll` | 557728 | `0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9` |
| `msvcp140_1.dll` | 35952 | `bfad5aef4c63a669e3c140655cdfdf395b6c979b400a447bd5dcb65ed8826c3d` |
| `vcruntime140.dll` | 124544 | `d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066` |
| `vcruntime140_1.dll` | 49792 | `1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f` |

Check with `sha256sum src-tauri/windows/vc-runtime/*.dll`.

## Where they end up

- **NSIS installer** — `src-tauri/tauri.windows.conf.json` lists them as
  `bundle.resources` mapped to their bare file names, so tauri-bundler writes
  them to `$INSTDIR` (the bundled resource directory *is* the install dir on
  Windows), right next to `voice.exe`. The same file must keep
  `resources/silero_vad_v4.onnx`: the platform config is merged with
  [JSON Merge Patch (RFC 7396)](https://datatracker.ietf.org/doc/html/rfc7396),
  so the object form of `resources` **replaces** the array in
  `tauri.conf.json` — anything omitted there is dropped from the Windows bundle.
- **Portable zip** — `scripts/build-all-platforms.sh`
  (`build_windows_portable_zip`) puts `voice.exe` (as `voxis.exe`) and these
  four DLLs (plus `resources/silero_vad_v4.onnx`, the installer's layout) into
  `voxis-windows-x64-portable.zip`.
- The bare `voxis-windows-x64-gui.exe` asset does **not** carry them; it still
  requires the Microsoft Visual C++ Redistributable 2015–2022 on the PC (or
  manual DLL copies).
- Linux/macOS bundles never see these files: the resources map lives only in the
  Windows platform config.

Windows' DLL search finds them app-locally (the exe's own directory), so no
registration or `PATH` change is involved.

`scripts/__tests__/windows-bundle.test.ts` guards all of it: it fails if the
Windows resources map drops the Silero model or one of the four DLLs, if a DLL
mounts under a subdirectory instead of the bare file name, or if the committed
bytes stop matching the hashes above.

## Refreshing

`vc_redist.x64.exe` is a WiX Burn bundle; `7z` cannot open its attached
container, so carve the embedded cabinets out by their own headers:

```bash
curl -LO https://aka.ms/vs/17/release/vc_redist.x64.exe

# Every cabinet starts with the 'MSCF' magic and carries its total size at
# offset 8 (CFHEADER.cbCabinet) -- carve each one out byte-exactly.
python3 - <<'PY'
import struct
data = open("vc_redist.x64.exe", "rb").read()
pos, n = 0, 0
while (pos := data.find(b"MSCF", pos)) != -1:
    size = struct.unpack_from("<I", data, pos + 8)[0]
    open(f"cab_{n}.cab", "wb").write(data[pos:pos + size])
    pos += size
    n += 1
print(n, "cabinets")
PY

mkdir out && cd out && 7z x ../cab_*.cab
# The CRT cabinet holds the runtime as `<name>.dll_amd64`; rename and verify.
for f in msvcp140.dll_amd64 msvcp140_1.dll_amd64 vcruntime140.dll_amd64 vcruntime140_1.dll_amd64; do
  cp "$f" "${f%_amd64}"
done
sha256sum msvcp140.dll msvcp140_1.dll vcruntime140.dll vcruntime140_1.dll
```

Then copy the four `.dll` files here, update the version and hashes above, and
check the new DLLs against `objdump -p` imports of a fresh
`voxis-windows-x64-gui.exe` before shipping. Re-run the Windows lane and confirm
the NSIS file list still carries `voice.exe` + these four DLLs +
`resources/silero_vad_v4.onnx` (see `.pi/skills/voxis-deploy/SKILL.md`,
"Windows runtime check").

## License

These files are Microsoft **Distributable Code** from the Microsoft Visual C++
Redistributable, © Microsoft Corporation. They are not covered by Voxis' MIT
license. The Visual Studio license terms permit app-local deployment of the
redistributable files with your program (the standard "copy the DLLs next to
your executable" redistributable pattern), unmodified; they are redistributed
here verbatim for that purpose only.
