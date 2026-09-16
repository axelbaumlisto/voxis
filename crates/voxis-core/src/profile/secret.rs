//! `Secret` \u2014 a newtype around API-key-shaped strings that refuses to leak
//! its contents through the ordinary `{:?}` / `{}` formatting paths.
//!
//! `[R1-Safety S8]`: `VoxisProfile`/`ProfileSecrets` travel through logs,
//! `unwrap()` panics, and test assertions all the time during development.
//! A plain `String` field holding a bearer credential (`api_key`,
//! `llm.api_key`) would happily print itself into any of those. `Secret`
//! makes that a compile-time-enforced non-issue: there is no `Display` impl,
//! `Debug` always prints the fixed placeholder, and there is no `Serialize`
//! impl at all \u2014 the only way to get the wrapped string out is the explicit
//! `expose()` call, which reads as "I am intentionally handling key
//! material" at every call site (`grep -n expose()` finds them all).

/// A secret string (API key, bearer token, ...). See module docs.
///
/// Deliberately does NOT derive/implement `serde::Serialize` \u2014 sealing code
/// must call `expose()` and put the result into a plain `String` field of an
/// internal DTO, which keeps every serialization boundary an explicit,
/// grep-able decision rather than an accidental derive.
/// `[ADO-2/3]` `ZeroizeOnDrop` wipes the wrapped `String`'s heap buffer
/// when a `Secret` (or an `Option<Secret>`/`Vec<Secret>` containing one)
/// goes out of scope, instead of leaving key material sitting in freed
/// memory. `String` implements `zeroize::Zeroize` under the crate's
/// default `alloc` feature (already enabled), so no extra `zeroize`
/// feature is needed here.
#[derive(Clone, PartialEq, Eq, zeroize::ZeroizeOnDrop)]
pub struct Secret(String);

impl Secret {
    /// Wrap a secret string.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Explicitly read the wrapped value. The only way out of `Secret`.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Secret([REDACTED])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_redacts_value() {
        let s = Secret::new("sk-super-secret-value");
        let debug = format!("{:?}", s);
        assert_eq!(debug, "Secret([REDACTED])");
        assert!(!debug.contains("sk-super-secret-value"));
    }

    #[test]
    fn expose_returns_original_value() {
        let s = Secret::new("sk-super-secret-value");
        assert_eq!(s.expose(), "sk-super-secret-value");
    }

    #[test]
    fn debug_redacts_value_inside_option_and_vec() {
        let opt: Option<Secret> = Some(Secret::new("sk-abc123"));
        let debug = format!("{:?}", opt);
        assert!(!debug.contains("sk-abc123"));

        let list = vec![Secret::new("sk-one"), Secret::new("sk-two")];
        let debug = format!("{:?}", list);
        assert!(!debug.contains("sk-one"));
        assert!(!debug.contains("sk-two"));
    }

    /// `[ADO-2/3]` Observing that a buffer was actually zeroed after `Drop`
    /// ran is UB (it's freed memory) -- so this pins the wipe-on-drop
    /// guarantee the only sound way available: a compile-time trait bound.
    /// If `Secret` ever stopped deriving/implementing `ZeroizeOnDrop`, this
    /// test would fail to *compile*, not just fail to run.
    #[test]
    fn secret_implements_zeroize_on_drop() {
        fn assert_zeroize_on_drop<T: zeroize::ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<Secret>();
    }
}
