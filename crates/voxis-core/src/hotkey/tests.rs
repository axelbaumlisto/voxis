use super::*;

#[test]
fn test_hotkey_parsing() {
    let parsed = HotkeyCombo::parse("Cmd+Shift+R").expect("hotkey should parse");

    assert_eq!(
        parsed.modifiers,
        vec![HotkeyModifier::Cmd, HotkeyModifier::Shift]
    );
    assert_eq!(parsed.key, "R");
}

#[test]
fn test_hotkey_to_string() {
    let hotkey = HotkeyCombo {
        modifiers: vec![HotkeyModifier::Cmd, HotkeyModifier::Shift],
        key: "R".to_string(),
    };

    assert_eq!(hotkey.to_string(), "Cmd+Shift+R");
}

#[test]
fn test_invalid_hotkey_format() {
    let invalid = HotkeyCombo::parse("Cmd+");
    assert!(invalid.is_err());

    let unknown_modifier = HotkeyCombo::parse("Hyper+R");
    assert!(matches!(
        unknown_modifier,
        Err(HotkeyParseError::UnknownModifier(modifier)) if modifier == "hyper"
    ));
}
