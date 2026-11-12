//! Overlay size rules — pure, so the window geometry has ONE definition.
//!
//! The overlay can be resized from its bottom-right corner (the orb themes can
//! be up to 160 logical px, and a user may want a bigger or smaller pill). The
//! resulting size is persisted (`overlay.custom_w/h`) and wins over the active
//! theme's manifest footprint until the user resets it.
//!
//! Everything here is a pure function over numbers: no Tauri, no window, no
//! config — the caller (overlay manager / command) owns the side effects. That
//! keeps the clamping rules testable and identical on both sides of the IPC.
//!
//! SQUARE ONLY: every theme draws into a square canvas and `orbUV()`-style
//! shaders normalise by `min(w, h)`; a non-square window would squash them.
//! The grip therefore resizes both axes together (the user drags a corner of a
//! square frame, which is what they see).

/// Smallest overlay the user may resize to. Below this the pill's own chrome
/// (and the corner grip) stops being reachable.
pub const MIN_OVERLAY_SIZE: u32 = 56;

/// Largest. 1024 logical px is a full third of a 13" display — anything above
/// is a window, not a pill, and starts fighting the always-on-top behaviour.
pub const MAX_OVERLAY_SIZE: u32 = 1024;

/// Clamp one axis into the supported range.
pub fn clamp_overlay_size(value: u32) -> u32 {
    value.clamp(MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)
}

/// A persisted size, if the config carries a usable pair.
pub fn custom_overlay_size(w: Option<u32>, h: Option<u32>) -> Option<(u32, u32)> {
    match (w, h) {
        (Some(w), Some(h)) => {
            let side = clamp_overlay_size(w.max(h));
            Some((side, side))
        }
        _ => None,
    }
}

/// The size the overlay window should be built/resized to: the user's, else the
/// theme's footprint, else `None` (the caller falls back to the pill default).
pub fn resolve_overlay_size(
    custom_w: Option<u32>,
    custom_h: Option<u32>,
    theme: Option<(u32, u32)>,
) -> Option<(u32, u32)> {
    custom_overlay_size(custom_w, custom_h).or(theme)
}

/// The result of dragging the bottom-right corner by `(dx, dy)` from `start`.
/// The square follows the LARGER axis movement, so a diagonal drag feels
/// natural in both directions and the frame never goes rectangular.
pub fn resize_from_corner(start: u32, dx: i32, dy: i32) -> u32 {
    let start = clamp_overlay_size(start);
    // The dominant axis wins: pushing right grows, pushing up shrinks, and a
    // strong horizontal drag still resizes even if the pointer drifts.
    let delta = if dx.abs() >= dy.abs() { dx } else { dy };
    clamp_overlay_size((start as i32).saturating_add(delta).max(0) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_into_the_supported_range() {
        assert_eq!(clamp_overlay_size(0), MIN_OVERLAY_SIZE);
        assert_eq!(clamp_overlay_size(10), MIN_OVERLAY_SIZE);
        assert_eq!(clamp_overlay_size(160), 160);
        assert_eq!(clamp_overlay_size(5000), MAX_OVERLAY_SIZE);
    }

    #[test]
    fn a_persisted_pair_becomes_a_square_and_a_half_pair_is_ignored() {
        assert_eq!(custom_overlay_size(Some(200), Some(160)), Some((200, 200)));
        assert_eq!(custom_overlay_size(Some(200), None), None);
        assert_eq!(custom_overlay_size(None, None), None);
        assert_eq!(custom_overlay_size(Some(1), Some(1)), Some((MIN_OVERLAY_SIZE, MIN_OVERLAY_SIZE)));
    }

    #[test]
    fn the_user_size_wins_over_the_theme_and_the_theme_wins_over_nothing() {
        assert_eq!(resolve_overlay_size(Some(300), Some(300), Some((160, 160))), Some((300, 300)));
        assert_eq!(resolve_overlay_size(None, None, Some((160, 160))), Some((160, 160)));
        assert_eq!(resolve_overlay_size(None, None, None), None);
    }

    #[test]
    fn resizing_follows_the_dominant_axis_and_cannot_leave_the_range() {
        assert_eq!(resize_from_corner(160, 40, 5), 200);
        assert_eq!(resize_from_corner(160, 5, -40), 120);
        assert_eq!(resize_from_corner(160, -1000, 0), MIN_OVERLAY_SIZE);
        assert_eq!(resize_from_corner(160, 5000, 0), MAX_OVERLAY_SIZE);
        // A diagonal drag of equal size takes the horizontal one (>=).
        assert_eq!(resize_from_corner(160, 30, 30), 190);
    }
}
