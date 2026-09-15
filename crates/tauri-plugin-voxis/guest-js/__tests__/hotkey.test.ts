// crates/tauri-plugin-voxis/guest-js/__tests__/hotkey.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindHotkey, HotkeyMachine, matchesHotkeySpec, UnrecognizedHotkeySpecError } from "../src/hotkey";

/**
 * `[REJECT-FIX M2]` An independent transcription of
 * `crates/voxis-core/src/hotkey/mod.rs`'s `KEY_TABLE` (as of the
 * `[R1-Migration S6]` rdev-feature move, lines ~40-231) — every alias
 * the Rust `parse_hotkey()` accepts, grouped by the rdev `Key` variant it
 * resolves to, paired with the `KeyboardEvent.code` this test asserts
 * `matchesHotkeySpec` accepts it as. Deliberately NOT imported from
 * `src/hotkey.ts`'s own `SINGLE_KEY_CODES` — that would make this test
 * pass trivially no matter how badly the two drift apart. Keep this list
 * in sync with mod.rs by hand; a future alias added to either side
 * without the other fails a case below.
 */
const RUST_KEY_TABLE_FIXTURE: Array<{ aliases: string[]; code: string }> = [
  // Modifiers (mod.rs KEY_TABLE ids 1-8).
  { aliases: ["alt_r", "alt_gr", "altgr"], code: "AltRight" },
  { aliases: ["ctrl_r", "control_r"], code: "ControlRight" },
  { aliases: ["shift_r"], code: "ShiftRight" },
  { aliases: ["alt_l", "alt"], code: "AltLeft" },
  { aliases: ["ctrl_l", "ctrl", "control_l", "control"], code: "ControlLeft" },
  { aliases: ["shift_l", "shift"], code: "ShiftLeft" },
  { aliases: ["super_r", "cmd_r", "meta_r"], code: "MetaRight" },
  { aliases: ["super_l", "super", "cmd_l", "cmd", "meta_l", "meta"], code: "MetaLeft" },
  // Function keys (ids 11-22).
  { aliases: ["f1"], code: "F1" },
  { aliases: ["f2"], code: "F2" },
  { aliases: ["f3"], code: "F3" },
  { aliases: ["f4"], code: "F4" },
  { aliases: ["f5"], code: "F5" },
  { aliases: ["f6"], code: "F6" },
  { aliases: ["f7"], code: "F7" },
  { aliases: ["f8"], code: "F8" },
  { aliases: ["f9"], code: "F9" },
  { aliases: ["f10"], code: "F10" },
  { aliases: ["f11"], code: "F11" },
  { aliases: ["f12"], code: "F12" },
  // Common keys (ids 30-45).
  { aliases: ["space"], code: "Space" },
  { aliases: ["enter", "return"], code: "Enter" },
  { aliases: ["tab"], code: "Tab" },
  { aliases: ["escape", "esc"], code: "Escape" },
  { aliases: ["backspace"], code: "Backspace" },
  { aliases: ["delete", "del"], code: "Delete" },
  { aliases: ["home"], code: "Home" },
  { aliases: ["end"], code: "End" },
  { aliases: ["page_up", "pageup"], code: "PageUp" },
  { aliases: ["page_down", "pagedown"], code: "PageDown" },
  { aliases: ["caps_lock", "capslock"], code: "CapsLock" },
  { aliases: ["insert"], code: "Insert" },
  { aliases: ["pause"], code: "Pause" },
  { aliases: ["print_screen", "printscreen"], code: "PrintScreen" },
  { aliases: ["scroll_lock", "scrolllock"], code: "ScrollLock" },
  { aliases: ["num_lock", "numlock"], code: "NumLock" },
];

function keyEvent(type: string, init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, ...init });
}

describe("matchesHotkeySpec", () => {
  it("matches a single-modifier spec (alt_r) by event.code", () => {
    const matches = matchesHotkeySpec("alt_r");
    expect(matches(keyEvent("keydown", { code: "AltRight" }))).toBe(true);
    expect(matches(keyEvent("keydown", { code: "AltLeft" }))).toBe(false);
  });

  it("matches ctrl_l against ControlLeft only", () => {
    const matches = matchesHotkeySpec("ctrl_l");
    expect(matches(keyEvent("keydown", { code: "ControlLeft" }))).toBe(true);
    expect(matches(keyEvent("keydown", { code: "ControlRight" }))).toBe(false);
  });

  it("matches a combo spec (Cmd+Shift+V) by modifiers + key", () => {
    const matches = matchesHotkeySpec("Cmd+Shift+V");
    expect(matches(keyEvent("keydown", { key: "v", metaKey: true, shiftKey: true }))).toBe(true);
    expect(matches(keyEvent("keydown", { key: "v", metaKey: true, shiftKey: false }))).toBe(false);
    expect(matches(keyEvent("keydown", { key: "b", metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("an unrecognized spec throws UnrecognizedHotkeySpecError (fail loud, not silently matches nothing) [REJECT-FIX M2]", () => {
    expect(() => matchesHotkeySpec("not a real spec!!")).toThrow(UnrecognizedHotkeySpecError);
  });

  it("HotkeyMachine's constructor throws the same error for an unrecognized spec [REJECT-FIX M2]", () => {
    expect(() => new HotkeyMachine({ matches: "bogus", onPressed: vi.fn(), onReleased: vi.fn() })).toThrow(
      UnrecognizedHotkeySpecError
    );
  });

  describe("every alias voxis_core::hotkey::KEY_TABLE accepts [REJECT-FIX M2]", () => {
    for (const { aliases, code } of RUST_KEY_TABLE_FIXTURE) {
      for (const alias of aliases) {
        it(`"${alias}" matches KeyboardEvent.code "${code}"`, () => {
          const matches = matchesHotkeySpec(alias);
          expect(matches(keyEvent("keydown", { code }))).toBe(true);
        });
      }
    }
  });
});

describe("HotkeyMachine", () => {
  it("fires onPressed once on keydown and onReleased on keyup", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const machine = new HotkeyMachine({ matches: "alt_r", onPressed, onReleased });

    machine.handleKeyDown(keyEvent("keydown", { code: "AltRight" }));
    expect(onPressed).toHaveBeenCalledTimes(1);
    expect(machine.isPressed).toBe(true);

    machine.handleKeyUp(keyEvent("keyup", { code: "AltRight" }));
    expect(onReleased).toHaveBeenCalledTimes(1);
    expect(machine.isPressed).toBe(false);
  });

  it("ignores auto-repeat keydowns — never re-fires onPressed while held", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const machine = new HotkeyMachine({ matches: "alt_r", onPressed, onReleased });

    machine.handleKeyDown(keyEvent("keydown", { code: "AltRight", repeat: false }));
    machine.handleKeyDown(keyEvent("keydown", { code: "AltRight", repeat: true }));
    machine.handleKeyDown(keyEvent("keydown", { code: "AltRight", repeat: true }));

    expect(onPressed).toHaveBeenCalledTimes(1);
  });

  it("ignores keydown/keyup for a non-matching key entirely", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const machine = new HotkeyMachine({ matches: "alt_r", onPressed, onReleased });

    machine.handleKeyDown(keyEvent("keydown", { code: "KeyA" }));
    expect(onPressed).not.toHaveBeenCalled();
    expect(machine.isPressed).toBe(false);
  });

  it("a window blur releases a held key", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const machine = new HotkeyMachine({ matches: "alt_r", onPressed, onReleased });

    machine.handleKeyDown(keyEvent("keydown", { code: "AltRight" }));
    machine.handleBlur();

    expect(onReleased).toHaveBeenCalledTimes(1);
    expect(machine.isPressed).toBe(false);
  });

  it("visibilitychange -> hidden releases a held key; -> visible does nothing", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const machine = new HotkeyMachine({ matches: "alt_r", onPressed, onReleased });

    machine.handleKeyDown(keyEvent("keydown", { code: "AltRight" }));
    machine.handleVisibilityChange(false);
    expect(onReleased).not.toHaveBeenCalled();

    machine.handleVisibilityChange(true);
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it("a lost keyup releases automatically after the timeout", () => {
    vi.useFakeTimers();
    try {
      const onPressed = vi.fn();
      const onReleased = vi.fn();
      const machine = new HotkeyMachine({ matches: "alt_r", onPressed, onReleased, lostKeyupTimeoutMs: 5000 });

      machine.handleKeyDown(keyEvent("keydown", { code: "AltRight" }));
      expect(onReleased).not.toHaveBeenCalled();

      vi.advanceTimersByTime(4999);
      expect(onReleased).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(onReleased).toHaveBeenCalledTimes(1);
      expect(machine.isPressed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a normal keyup before the lost-keyup timeout cancels the timer (no double release)", () => {
    vi.useFakeTimers();
    try {
      const onPressed = vi.fn();
      const onReleased = vi.fn();
      const machine = new HotkeyMachine({ matches: "alt_r", onPressed, onReleased, lostKeyupTimeoutMs: 5000 });

      machine.handleKeyDown(keyEvent("keydown", { code: "AltRight" }));
      machine.handleKeyUp(keyEvent("keyup", { code: "AltRight" }));
      expect(onReleased).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(6000);
      expect(onReleased).toHaveBeenCalledTimes(1); // still just once
    } finally {
      vi.useRealTimers();
    }
  });

  describe("combo release order (\"Ctrl+Shift+V\") [REJECT-FIX M3]", () => {
    function pressCombo(machine: HotkeyMachine) {
      machine.handleKeyDown(keyEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true, shiftKey: true }));
    }

    it("releases when the main key comes up first (Ctrl/Shift still held)", () => {
      const onPressed = vi.fn();
      const onReleased = vi.fn();
      const machine = new HotkeyMachine({ matches: "Ctrl+Shift+V", onPressed, onReleased });

      pressCombo(machine);
      expect(onPressed).toHaveBeenCalledTimes(1);

      machine.handleKeyUp(keyEvent("keyup", { key: "v", code: "KeyV", ctrlKey: true, shiftKey: true }));

      expect(onReleased).toHaveBeenCalledTimes(1);
      expect(machine.isPressed).toBe(false);
    });

    it("releases when Ctrl comes up first (main key/Shift still notionally held) — the common real-world order that used to stay stuck until the 5s lost-keyup timer", () => {
      const onPressed = vi.fn();
      const onReleased = vi.fn();
      const machine = new HotkeyMachine({ matches: "Ctrl+Shift+V", onPressed, onReleased });

      pressCombo(machine);
      expect(onPressed).toHaveBeenCalledTimes(1);

      // Ctrl's own keyup: browsers report ctrlKey: false on this event
      // (Ctrl itself is what's being released), key: "Control".
      machine.handleKeyUp(keyEvent("keyup", { key: "Control", ctrlKey: false, shiftKey: true }));

      expect(onReleased).toHaveBeenCalledTimes(1);
      expect(machine.isPressed).toBe(false);
    });

    it("releases when Shift comes up first", () => {
      const onPressed = vi.fn();
      const onReleased = vi.fn();
      const machine = new HotkeyMachine({ matches: "Ctrl+Shift+V", onPressed, onReleased });

      pressCombo(machine);

      machine.handleKeyUp(keyEvent("keyup", { key: "Shift", ctrlKey: true, shiftKey: false }));

      expect(onReleased).toHaveBeenCalledTimes(1);
      expect(machine.isPressed).toBe(false);
    });

    it("a second keyup from another combo member after release is a no-op (already released, no double-release)", () => {
      const onPressed = vi.fn();
      const onReleased = vi.fn();
      const machine = new HotkeyMachine({ matches: "Ctrl+Shift+V", onPressed, onReleased });

      pressCombo(machine);
      machine.handleKeyUp(keyEvent("keyup", { key: "Control", ctrlKey: false, shiftKey: true }));
      machine.handleKeyUp(keyEvent("keyup", { key: "Shift", ctrlKey: false, shiftKey: false }));

      expect(onReleased).toHaveBeenCalledTimes(1);
    });

    it("an unrelated keyup does not release the combo", () => {
      const onPressed = vi.fn();
      const onReleased = vi.fn();
      const machine = new HotkeyMachine({ matches: "Ctrl+Shift+V", onPressed, onReleased });

      pressCombo(machine);
      machine.handleKeyUp(keyEvent("keyup", { key: "a", code: "KeyA" }));

      expect(onReleased).not.toHaveBeenCalled();
      expect(machine.isPressed).toBe(true);
    });
  });
});

describe("bindHotkey", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("wires keydown/keyup on document to the spec", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const bound = bindHotkey({ key: "alt_r", mode: "hold" }, { onPressed, onReleased });

    document.dispatchEvent(keyEvent("keydown", { code: "AltRight" }));
    expect(onPressed).toHaveBeenCalledTimes(1);

    document.dispatchEvent(keyEvent("keyup", { code: "AltRight" }));
    expect(onReleased).toHaveBeenCalledTimes(1);

    bound.destroy();
  });

  it("a window blur while held releases, routed through the real window", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const bound = bindHotkey({ key: "alt_r", mode: "hold" }, { onPressed, onReleased });

    document.dispatchEvent(keyEvent("keydown", { code: "AltRight" }));
    window.dispatchEvent(new Event("blur"));

    expect(onReleased).toHaveBeenCalledTimes(1);
    bound.destroy();
  });

  it("destroy() stops further keydown/keyup from reaching the machine", () => {
    const onPressed = vi.fn();
    const onReleased = vi.fn();
    const bound = bindHotkey({ key: "alt_r", mode: "hold" }, { onPressed, onReleased });
    bound.destroy();

    document.dispatchEvent(keyEvent("keydown", { code: "AltRight" }));
    expect(onPressed).not.toHaveBeenCalled();
  });
});
