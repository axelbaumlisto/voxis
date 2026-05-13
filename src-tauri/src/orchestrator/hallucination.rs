//! Whisper hallucination filter.
//!
//! Whisper-family ASR models produce well-known phrases when fed silence
//! or very low-energy audio. Examples observed in real TALRI logs:
//!
//!   * "Продолжение следует..."  (Russian: "to be continued...")
//!   * "Субтитры сделал DimaTorzok"
//!   * "Thanks for watching!" / "Subscribe to my channel"
//!   * "Music" / "[Music]"
//!
//! This module exposes a single pure function — [`is_likely_hallucination`] —
//! used by the transcription pipeline to discard such results BEFORE they
//! reach the output stage (clipboard / auto-type).
//!
//! Design choices (SOLID + KISS):
//!  - SRP: pure text classifier, no I/O, no side effects.
//!  - OCP: extending the blacklist is a one-liner; matching is uniform.
//!  - Pure function => trivially testable.

/// Canonical (lowercased) hallucination snippets. A transcription is
/// considered a hallucination if, after normalisation, **the whole text**
/// matches one of these (allowing for trailing punctuation / ellipsis).
///
/// We deliberately keep the list short and curated — every entry is a
/// phrase observed in practice on TALRI's silent recordings. Aggressive
/// substring matching is avoided to prevent false positives on real
/// speech that happens to contain a common word.
const KNOWN_HALLUCINATIONS: &[&str] = &[
    // --- Russian ---
    "продолжение следует",
    "спасибо за просмотр",
    "спасибо за внимание",
    "субтитры сделал dimatorzok",
    "субтитры подогнал",
    "редактор субтитров",
    "корректор",
    // --- English ---
    "thanks for watching",
    "thank you for watching",
    "subscribe to my channel",
    "music",
    "[music]",
    "♪",
    "(music)",
    "you",
    // --- Other ---
    "기독교 방송",
    "字幕 by ",
];

/// Returns `true` when `text`, after normalisation, looks like one of the
/// known Whisper hallucination phrases.
///
/// Normalisation:
///   - trim leading/trailing whitespace
///   - lower-case (Unicode-aware via `to_lowercase`)
///   - strip trailing punctuation / ellipsis (`.`, `…`, `!`, `?`, `,`, `:`)
///
/// Whitespace inside is preserved so that legitimate phrases like
/// "Спасибо за просмотр видео отчёта" still pass through (only exact
/// matches against the blacklist are dropped).
pub fn is_likely_hallucination(text: &str) -> bool {
    let normalised = normalise(text);
    if normalised.is_empty() {
        // Whisper returning empty / whitespace-only output is, in our
        // pipeline, also a hallucination: there was no speech.
        return true;
    }
    KNOWN_HALLUCINATIONS
        .iter()
        .any(|needle| normalised == *needle)
}

/// Same as [`is_likely_hallucination`] but tolerant of *some* extra
/// content. Used for diagnostics; not the production filter.
#[cfg(test)]
pub fn debug_contains_hallucination(text: &str) -> bool {
    let normalised = normalise(text);
    KNOWN_HALLUCINATIONS
        .iter()
        .any(|needle| normalised.contains(needle))
}

fn normalise(text: &str) -> String {
    let trimmed = text.trim();
    // Strip trailing punctuation / ellipsis characters iteratively.
    let stripped: &str = {
        let mut end = trimmed.len();
        while let Some(ch) = trimmed[..end].chars().next_back() {
            if matches!(
                ch,
                '.' | '…' | '!' | '?' | ',' | ':' | ';' | ' ' | '\t' | '\n'
            ) {
                end -= ch.len_utf8();
            } else {
                break;
            }
        }
        &trimmed[..end]
    };
    stripped.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_russian_continued() {
        assert!(is_likely_hallucination("Продолжение следует..."));
        assert!(is_likely_hallucination("Продолжение следует…"));
        assert!(is_likely_hallucination(" Продолжение следует.. "));
        assert!(is_likely_hallucination("продолжение следует"));
    }

    #[test]
    fn drops_russian_thanks() {
        assert!(is_likely_hallucination("Спасибо за просмотр!"));
        assert!(is_likely_hallucination("Спасибо за просмотр."));
        assert!(is_likely_hallucination("спасибо за внимание"));
    }

    #[test]
    fn drops_english_phrases() {
        assert!(is_likely_hallucination("Thanks for watching!"));
        assert!(is_likely_hallucination("Subscribe to my channel."));
        assert!(is_likely_hallucination("Music"));
        assert!(is_likely_hallucination("[Music]"));
    }

    #[test]
    fn drops_empty_or_whitespace() {
        assert!(is_likely_hallucination(""));
        assert!(is_likely_hallucination("   "));
        assert!(is_likely_hallucination("\t\n"));
        assert!(is_likely_hallucination("..."));
        assert!(is_likely_hallucination("…"));
    }

    #[test]
    fn keeps_real_speech() {
        assert!(!is_likely_hallucination("Привет, как дела?"));
        assert!(!is_likely_hallucination("Hello world"));
        // Long sentence that *contains* a hallucination snippet but
        // is not equal to one — keep, because aggressive matching
        // would cause false positives on real speech.
        assert!(!is_likely_hallucination(
            "Спасибо за просмотр моего видео, продолжение будет завтра"
        ));
    }

    #[test]
    fn keeps_short_real_words() {
        assert!(!is_likely_hallucination("Ок"));
        assert!(!is_likely_hallucination("Да"));
        assert!(!is_likely_hallucination("Yes"));
    }

    #[test]
    fn handles_dimatorzok_signature() {
        // Whisper sometimes signs silence with the translator credit.
        assert!(is_likely_hallucination("Субтитры сделал DimaTorzok"));
        assert!(is_likely_hallucination("субтитры сделал dimatorzok"));
    }

    #[test]
    fn debug_contains_finds_substrings() {
        // Sanity check for the diagnostic helper (NOT used in production).
        assert!(debug_contains_hallucination(
            "это было длинно... продолжение следует"
        ));
        assert!(!debug_contains_hallucination(
            "completely unrelated speech"
        ));
    }
}
