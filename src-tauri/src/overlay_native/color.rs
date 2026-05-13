//! Tiny RGBA color type for theme palettes.
//!
//! Used to replace the single `egui::Color32` symbol that was the only
//! remaining reason to keep the (~3 MB unpacked) `egui` crate as a
//! dependency. The egui dep was a Phase-7-cleanup leftover; removing
//! it cuts ~30 transitive crates and shaves several seconds off cold
//! `cargo build`.
//!
//! API surface mirrors what `overlay_native::theme` was using:
//!   - `Color32::from_rgb(r, g, b)`
//!   - `Color32::from_rgba_unmultiplied(r, g, b, a)`
//!   - `Color32::from_rgba_premultiplied(r, g, b, a)`
//!   - `.r()` `.g()` `.b()` `.a()` accessors
//!   - `Color32::WHITE` / `BLACK` / `TRANSPARENT` constants
//!
//! SRP: ONE type, no rendering, no conversions to external formats.
//! KISS: 8-byte struct, all methods are 1-2 lines.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Color32 {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

impl Color32 {
    pub const WHITE: Color32 = Color32 {
        r: 255,
        g: 255,
        b: 255,
        a: 255,
    };
    pub const BLACK: Color32 = Color32 {
        r: 0,
        g: 0,
        b: 0,
        a: 255,
    };
    pub const TRANSPARENT: Color32 = Color32 {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    };

    /// Opaque RGB constructor (alpha = 255).
    pub const fn from_rgb(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b, a: 255 }
    }

    /// Construct from straight (un-premultiplied) RGBA. We don't run
    /// any blending math here; the value is stored verbatim. The
    /// `_unmultiplied` / `_premultiplied` naming is preserved from
    /// `egui::Color32` for call-site source compatibility.
    pub const fn from_rgba_unmultiplied(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    /// Same as `from_rgba_unmultiplied` \u2014 we don't carry the
    /// pre/un-multiplied distinction. Provided for source-compat with
    /// the small number of egui call sites that used this form.
    pub const fn from_rgba_premultiplied(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    pub const fn r(self) -> u8 {
        self.r
    }
    pub const fn g(self) -> u8 {
        self.g
    }
    pub const fn b(self) -> u8 {
        self.b
    }
    pub const fn a(self) -> u8 {
        self.a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructors_preserve_fields() {
        let c = Color32::from_rgb(10, 20, 30);
        assert_eq!((c.r(), c.g(), c.b(), c.a()), (10, 20, 30, 255));
        let c = Color32::from_rgba_unmultiplied(10, 20, 30, 40);
        assert_eq!((c.r(), c.g(), c.b(), c.a()), (10, 20, 30, 40));
        let c = Color32::from_rgba_premultiplied(10, 20, 30, 40);
        assert_eq!((c.r(), c.g(), c.b(), c.a()), (10, 20, 30, 40));
    }

    #[test]
    fn well_known_constants() {
        assert_eq!(Color32::WHITE, Color32::from_rgb(255, 255, 255));
        assert_eq!(Color32::BLACK, Color32::from_rgb(0, 0, 0));
        assert_eq!(
            Color32::TRANSPARENT,
            Color32::from_rgba_unmultiplied(0, 0, 0, 0)
        );
    }

    #[test]
    fn equality_is_byte_exact() {
        // Critical for the theme code that compares parsed colors
        // against expected literals.
        let a = Color32::from_rgb(0xff, 0x00, 0x80);
        let b = Color32::from_rgb(0xff, 0x00, 0x80);
        let c = Color32::from_rgb(0xff, 0x01, 0x80);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
