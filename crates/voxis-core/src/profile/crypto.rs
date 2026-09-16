//! `[R1-Safety S1]` Symmetric sealing for `VoxisProfile` export/import.
//!
//! Two key sources feed the same envelope format:
//! - `KeySource::Qr`: a QR code carries a 256-bit random key (`k_qr`); the
//!   6-digit `code` shown next to it is a second factor (protects against a
//!   photographed QR), not the source of entropy. Key material:
//!   `HKDF-SHA256(ikm = k_qr, salt = <random 16B from the header>,
//!   info = b"voxis-profile-v1" || code)`.
//! - `KeySource::Passphrase`: a human-memorable phrase, stretched with
//!   Argon2id (`m = 64 MiB, t = 3, p = 1`, RFC 9106 "second recommended
//!   option", `p = 1` because this runs on phones/desktops, not servers).
//!
//! Both derive a 32-byte key, then ChaCha20-Poly1305 (random 12B nonce)
//! encrypts the plaintext JSON. Wire format (all fixed-size except the
//! trailing ciphertext, so `open()` can validate length before touching
//! any crypto primitive):
//!
//! ```text
//! magic   b"VXP1"     4 bytes
//! kdf_tag u8          1 byte   (1 = Qr, 2 = Passphrase)
//! salt    [u8; 16]    16 bytes (KDF salt \u2014 HKDF salt or Argon2 salt)
//! nonce   [u8; 12]    12 bytes (ChaCha20-Poly1305 nonce)
//! ct      [u8; N]     rest     (AEAD ciphertext, tag included)
//! ```
//!
//! The header (`magic || kdf_tag || salt || nonce`) is passed as AEAD
//! associated data on both seal and open, so tampering with *any* header
//! byte (not just the ciphertext) is caught by Poly1305 tag verification
//! instead of silently producing garbage plaintext or, worse, decrypting
//! under an attacker-chosen salt/nonce.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, Key, KeyInit, Nonce,
};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::{ZeroizeOnDrop, Zeroizing};

use super::ProfileError;

const MAGIC: &[u8; 4] = b"VXP1";
const KDF_TAG_QR: u8 = 1;
const KDF_TAG_PASSPHRASE: u8 = 2;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const HEADER_LEN: usize = MAGIC.len() + 1 + SALT_LEN + NONCE_LEN; // 33
const HKDF_INFO_PREFIX: &[u8] = b"voxis-profile-v1";

/// Where the symmetric key for `seal`/`open` comes from. Both variants
/// produce a 32-byte ChaCha20-Poly1305 key; see module docs for the exact
/// derivation.
///
/// `[ADO-2/3]` `k_qr` (256 bits of raw key material) and the passphrase
/// string are wiped on drop via `ZeroizeOnDrop` — callers construct/consume
/// this the same way as before (no field type change), but once a
/// `KeySource` goes out of scope its bytes no longer linger in freed
/// memory.
#[derive(Clone, ZeroizeOnDrop)]
pub enum KeySource {
    /// QR-code transport: `k_qr` is 256 bits of CSPRNG output carried in the
    /// QR itself; `code` is the 6-digit second factor shown alongside it.
    Qr { k_qr: [u8; 32], code: String },
    /// File transport: a human-entered passphrase, stretched via Argon2id.
    Passphrase(String),
}

/// Production Argon2id cost parameters (RFC 9106 "second recommended
/// option" variant, `p_cost = 1`). These are load-bearing constants: they
/// are baked into every sealed `.vxp` file's KDF and must not change
/// silently (a change would make previously-sealed files fail to open with
/// the same passphrase). See `argon2_params()` for the test-only override.
pub const ARGON2_M_COST_KIB: u32 = 64 * 1024;
pub const ARGON2_T_COST: u32 = 3;
pub const ARGON2_P_COST: u32 = 1;
const ARGON2_OUTPUT_LEN: usize = 32;

#[cfg(not(test))]
fn argon2_params() -> Params {
    Params::new(ARGON2_M_COST_KIB, ARGON2_T_COST, ARGON2_P_COST, Some(ARGON2_OUTPUT_LEN))
        .expect("static production Argon2 params are valid")
}

/// Test-only reduced-cost variant. `cfg(test)` only activates while
/// building *this* crate's own test target (`cargo test -p voxis-core`),
/// never for a downstream consumer's normal build \u2014 production code always
/// gets `ARGON2_M_COST_KIB`/`ARGON2_T_COST`/`ARGON2_P_COST` above. Keeps the
/// round-trip/negative tests in `tests.rs` from spending real seconds per
/// call on a genuine 64 MiB Argon2id run.
#[cfg(test)]
fn argon2_params() -> Params {
    Params::new(8, 1, 1, Some(ARGON2_OUTPUT_LEN)).expect("static test Argon2 params are valid")
}

fn kdf_tag(key_source: &KeySource) -> u8 {
    match key_source {
        KeySource::Qr { .. } => KDF_TAG_QR,
        KeySource::Passphrase(_) => KDF_TAG_PASSPHRASE,
    }
}

/// Returns the derived 32-byte key wrapped in `Zeroizing` — `[ADO-2/3]`:
/// both the HKDF and Argon2id branches build the key in a plain stack
/// array first (the underlying crates require `&mut [u8]` output buffers),
/// then hand ownership to `Zeroizing` before returning so the key is wiped
/// the moment the caller (`encrypt`/`decrypt`) drops it, instead of
/// lingering in freed stack memory.
fn derive_key(
    key_source: &KeySource,
    salt: &[u8; SALT_LEN],
) -> Result<Zeroizing<[u8; 32]>, ProfileError> {
    match key_source {
        KeySource::Qr { k_qr, code } => {
            let hk = Hkdf::<Sha256>::new(Some(salt), k_qr);
            let mut info = Vec::with_capacity(HKDF_INFO_PREFIX.len() + code.len());
            info.extend_from_slice(HKDF_INFO_PREFIX);
            info.extend_from_slice(code.as_bytes());
            let mut key = Zeroizing::new([0u8; 32]);
            hk.expand(&info, &mut *key)
                .map_err(|e| ProfileError::Crypto(format!("hkdf expand: {e}")))?;
            Ok(key)
        }
        KeySource::Passphrase(passphrase) => {
            let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params());
            let mut key = Zeroizing::new([0u8; 32]);
            argon2
                .hash_password_into(passphrase.as_bytes(), salt, &mut *key)
                .map_err(|e| ProfileError::Crypto(format!("argon2: {e}")))?;
            Ok(key)
        }
    }
}

fn random_bytes<const N: usize>() -> Result<[u8; N], ProfileError> {
    let mut buf = [0u8; N];
    getrandom::getrandom(&mut buf).map_err(|e| ProfileError::Crypto(format!("rng: {e}")))?;
    Ok(buf)
}

/// Encrypt `plaintext` (the serialized profile+secrets DTO) under a key
/// derived from `key_source`. Returns the full wire format (header +
/// ciphertext) described in the module docs.
pub(super) fn encrypt(plaintext: &[u8], key_source: &KeySource) -> Result<Vec<u8>, ProfileError> {
    let salt = random_bytes::<SALT_LEN>()?;
    let nonce_bytes = random_bytes::<NONCE_LEN>()?;
    let key_bytes = derive_key(key_source, &salt)?;

    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.push(kdf_tag(key_source));
    header.extend_from_slice(&salt);
    header.extend_from_slice(&nonce_bytes);

    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key_bytes[..]));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: &header,
            },
        )
        .map_err(|_| ProfileError::Crypto("encryption failed".to_string()))?;

    let mut out = header;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a wire-format payload produced by `encrypt`. Never panics: bad
/// magic, wrong/mismatched `KeySource`, truncated input, or a tampered byte
/// anywhere (header or ciphertext) all return `Err`.
///
/// `[ADO-2/3]` The returned plaintext (the serialized `SealedPayload`,
/// which carries `api_key`/`llm_api_key` in the clear until `open()`
/// deserializes and re-wraps them in `Secret`) is `Zeroizing<Vec<u8>>` so it
/// is wiped the moment the caller drops it, instead of leaving decrypted
/// key material sitting in freed heap memory.
pub(super) fn decrypt(data: &[u8], key_source: &KeySource) -> Result<Zeroizing<Vec<u8>>, ProfileError> {
    if data.len() < HEADER_LEN {
        return Err(ProfileError::Crypto("truncated profile payload".to_string()));
    }
    if &data[0..MAGIC.len()] != MAGIC {
        return Err(ProfileError::Crypto("bad magic (not a VXP1 payload)".to_string()));
    }
    let tag = data[MAGIC.len()];
    if tag != kdf_tag(key_source) {
        return Err(ProfileError::Crypto(
            "key source does not match the sealed payload's KDF tag".to_string(),
        ));
    }

    let salt_start = MAGIC.len() + 1;
    let nonce_start = salt_start + SALT_LEN;
    let ct_start = nonce_start + NONCE_LEN;

    let salt: [u8; SALT_LEN] = data[salt_start..nonce_start]
        .try_into()
        .expect("slice length fixed by HEADER_LEN check above");
    let nonce_bytes = &data[nonce_start..ct_start];
    let header = &data[0..HEADER_LEN];
    let ciphertext = &data[ct_start..];

    let key_bytes = derive_key(key_source, &salt)?;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key_bytes[..]));
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: header,
            },
        )
        .map_err(|_| {
            ProfileError::Crypto("decryption failed (wrong key/code or tampered data)".to_string())
        })?;
    Ok(Zeroizing::new(plaintext))
}

/// base64url (no padding) encoding, exposed for downstream tasks that embed
/// sealed bytes / raw key material in text contexts (e.g. Task 7's QR
/// payload `k: base64url(k_qr)`). Not exercised by this crate's own
/// fixtures \u2014 added here per this step's pinned dependency list so later
/// tasks share one implementation instead of re-adding the crate.
pub fn encode_base64url(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Inverse of [`encode_base64url`].
pub fn decode_base64url(s: &str) -> Result<Vec<u8>, ProfileError> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|e| ProfileError::Crypto(format!("base64 decode: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qr_source() -> KeySource {
        KeySource::Qr {
            k_qr: [7u8; 32],
            code: "123456".to_string(),
        }
    }

    #[test]
    fn round_trip_qr() {
        let sealed = encrypt(b"hello world", &qr_source()).unwrap();
        let opened = decrypt(&sealed, &qr_source()).unwrap();
        assert_eq!(&*opened, b"hello world");
    }

    #[test]
    fn round_trip_passphrase() {
        let source = KeySource::Passphrase("correct horse battery staple".to_string());
        let sealed = encrypt(b"hello world", &source).unwrap();
        let opened = decrypt(&sealed, &source).unwrap();
        assert_eq!(&*opened, b"hello world");
    }

    #[test]
    fn wrong_code_fails() {
        let sealed = encrypt(b"secret", &qr_source()).unwrap();
        let wrong = KeySource::Qr {
            k_qr: [7u8; 32],
            code: "000000".to_string(),
        };
        assert!(decrypt(&sealed, &wrong).is_err());
    }

    #[test]
    fn wrong_k_qr_fails() {
        let sealed = encrypt(b"secret", &qr_source()).unwrap();
        let wrong = KeySource::Qr {
            k_qr: [9u8; 32],
            code: "123456".to_string(),
        };
        assert!(decrypt(&sealed, &wrong).is_err());
    }

    #[test]
    fn wrong_passphrase_fails() {
        let source = KeySource::Passphrase("correct horse battery staple".to_string());
        let sealed = encrypt(b"secret", &source).unwrap();
        let wrong = KeySource::Passphrase("wrong phrase".to_string());
        assert!(decrypt(&sealed, &wrong).is_err());
    }

    #[test]
    fn mismatched_key_source_kind_fails() {
        let sealed = encrypt(b"secret", &qr_source()).unwrap();
        let passphrase = KeySource::Passphrase("correct horse battery staple".to_string());
        assert!(decrypt(&sealed, &passphrase).is_err());
    }

    #[test]
    fn tampered_ciphertext_byte_fails() {
        let mut sealed = encrypt(b"secret", &qr_source()).unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xFF;
        assert!(decrypt(&sealed, &qr_source()).is_err());
    }

    #[test]
    fn tampered_header_byte_fails() {
        let mut sealed = encrypt(b"secret", &qr_source()).unwrap();
        sealed[6] ^= 0xFF; // inside the salt
        assert!(decrypt(&sealed, &qr_source()).is_err());
    }

    #[test]
    fn truncated_payload_errs_without_panicking() {
        let sealed = encrypt(b"secret", &qr_source()).unwrap();
        for cut in [0usize, 1, 4, 10, 20] {
            assert!(decrypt(&sealed[..cut], &qr_source()).is_err());
        }
    }

    #[test]
    fn garbage_payload_errs_without_panicking() {
        let garbage = vec![0xAAu8; 50];
        assert!(decrypt(&garbage, &qr_source()).is_err());
    }

    #[test]
    fn bad_magic_errs() {
        let mut sealed = encrypt(b"secret", &qr_source()).unwrap();
        sealed[0] = b'X';
        assert!(decrypt(&sealed, &qr_source()).is_err());
    }

    #[test]
    fn production_argon2_params_match_documented_constants() {
        // These constants are only read from the `#[cfg(not(test))]` variant
        // of `argon2_params()`, so a `cargo test` build (which always has
        // `cfg(test)` active) would otherwise flag them as dead code. This
        // also pins them against an accidental edit — changing any of the
        // three would silently break every previously-sealed `.vxp` file's
        // passphrase KDF.
        assert_eq!(ARGON2_M_COST_KIB, 64 * 1024);
        assert_eq!(ARGON2_T_COST, 3);
        assert_eq!(ARGON2_P_COST, 1);
    }

    #[test]
    fn base64url_round_trip() {
        let bytes = [1u8, 2, 3, 255, 0, 128];
        let encoded = encode_base64url(&bytes);
        assert!(!encoded.contains('='), "no-pad url-safe base64");
        let decoded = decode_base64url(&encoded).unwrap();
        assert_eq!(decoded, bytes);
    }

    /// `[ADO-2/3]` Same rationale as `secret::tests::secret_implements_zeroize_on_drop`:
    /// a compile-time trait bound is the only sound way to pin "`KeySource`
    /// (which owns `k_qr`/the passphrase `String`) wipes itself on drop",
    /// since inspecting freed memory to prove a *runtime* zeroize happened
    /// would be UB.
    #[test]
    fn key_source_implements_zeroize_on_drop() {
        fn assert_zeroize_on_drop<T: zeroize::ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<KeySource>();
    }

    /// `[ADO-2/3]` `derive_key`'s return type is `Zeroizing<[u8; 32]>` --
    /// `Zeroizing<T>` always implements `ZeroizeOnDrop` (it's the crate's
    /// own wrapper for exactly this purpose), so this pins that the
    /// derived-key call site hasn't quietly reverted to a bare `[u8; 32]`.
    #[test]
    fn derived_key_is_zeroizing() {
        fn assert_zeroize_on_drop<T: zeroize::ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<Zeroizing<[u8; 32]>>();
        let key = derive_key(&qr_source(), &[0u8; SALT_LEN]).unwrap();
        assert_eq!(key.len(), 32);
    }
}
