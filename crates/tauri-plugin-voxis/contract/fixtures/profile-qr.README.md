# `profile-qr.json` wire contract (Task 6 <-> Task 7)

This is the contract `tauri-plugin-voxis::profile_source::import_from_qr`
(Task 6, client) and Voxis desktop's `profile_share::server` (Task 7,
server) both implement independently, built concurrently against this one
document + `profile-qr.json`. A change to either side must update both.

## QR payload (`profile-qr.json`)

JSON, `{v, host, port, token, k}` — this is what the QR code encodes (and
what a user could type in by hand if scanning fails):

```json
{
  "v": 1,
  "host": "192.168.1.42",
  "port": 4217,
  "token": "b2b48c1e-9f3a-4b7e-8c1a-6d4f2e9a7b10",
  "k": "3q2-7w1s5F0P9xJf6uY8bN2mZaC4vD1eR7tG5hK9lQ0"
}
```

- `v`: payload version. `1` is the only version either side understands
  today; the client rejects anything else before making any network call.
- `host`/`port`: the LAN IP Task 7's server bound to (never `0.0.0.0`) and
  its listening port.
- `token`: a single-use random identifier for this share session. Bound to
  the *first* client IP that redeems it; every request after that (whether
  a genuine retry or an attacker replay) gets `410`.
- `k`: `base64url` (no padding) of `k_qr` — 256 bits of CSPRNG output. This
  is the actual key material; the 6-digit `code` shown next to the QR on
  the sharing device is a **second factor only** (protects against a
  photographed/leaked QR image), never part of this payload, and never
  transmitted over the network by either side.

**No custom URL scheme** (`voxis://...`): the payload is plain JSON, either
scanned by the host app's own camera view or pasted by hand — a registered
URL scheme could be hijacked by an unrelated app to steal `token`+`k`.

## HTTP transport

`GET http://{host}:{port}/profile?token={token}` — plain HTTP, not HTTPS
(LAN-only, single-use token, short server lifetime; see Task 7's own
acceptance for the full threat-model writeup). The client
(`profile_source::fetch_sealed_profile`) uses a 10s request timeout.

Responses:

| Status | Body | Meaning |
|---|---|---|
| `200 OK` | `application/octet-stream`, the sealed profile bytes (`voxis_core::profile::seal`'s `VXP1` wire format) | Success — token redeemed, server retires it immediately (any further request, including the exact same token again, gets `410`). |
| `410 Gone` | Constant-size body (implementation detail: a fixed dummy payload, NOT empty and NOT proportional to any real data) | Token already used, expired (past the share window), or never existed. **Never distinguished from each other** — a distinguishable "wrong token" vs. "already used" response would leak whether a guessed token was ever valid. |
| any other non-2xx | unspecified body | Treated by the client as a generic transport failure (`PluginError::Profile` naming the HTTP status), not retried automatically. |

The client never logs `token`/`k`/the response body. The server's own
access log must not include `token` either (Task 7 acceptance).

## Opening the sealed bytes

Once the client has the `200` body, it opens it exactly like any other
sealed `VoxisProfile`:

```rust
let key_source = voxis_core::profile::KeySource::Qr {
    k_qr: /* decode_base64url(payload.k), must be exactly 32 bytes */,
    code: /* the 6-digit code, supplied by the command caller, NOT from the QR payload */,
};
let (profile, secrets) = voxis_core::profile::open(&body_bytes, &key_source)?;
```

A wrong `code` or a `k`/ciphertext mismatch both fail *here* (AEAD tag
verification, `voxis_core::profile::crypto`), not at the HTTP layer — the
server has no way to know whether the code the user will type is correct;
it only gates *who* gets to fetch the ciphertext at all (the single-use
`token`).

## Ownership boundary

- Task 6 (`crates/tauri-plugin-voxis/src/profile_source.rs`): the client
  side above — parses the QR payload, does the GET, calls `open`, then
  routes the result through the same `apply_imported_profile` every other
  import path (desktop directory read, `.vxp` file) uses.
- Task 7 (`src-tauri/src/profile_share/`): the server side — token
  issuance/single-use enforcement, LAN-IP binding, the QR image itself,
  and `seal`-ing the desktop's current profile under `KeySource::Qr` when
  the token is redeemed.

Both sides validate independently against `profile-qr.json`; this file is
the shared prose description neither side's own code comments should need
to repeat.
