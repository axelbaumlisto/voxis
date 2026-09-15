// crates/tauri-plugin-voxis/guest-js/src/hotkey.ts
/**
 * In-app hotkey (plan Approach decision 5: "iPad with an external
 * keyboard / desktop webview — `keydown`/`keyup` in JS when the host is
 * focused"): a pure Pressed/Released state machine (`HotkeyMachine`,
 * testable with plain synthetic `KeyboardEvent`s, no `document`) plus
 * `bindHotkey`, which wires it to `document`/`window`.
 *
 * Safety properties the machine itself enforces (not just "hope the
 * browser sends a matching keyup"):
 * - auto-repeat (`KeyboardEvent.repeat`) never re-fires `pressed`.
 * - window `blur` / `document.visibilitychange` -> `hidden` release
 *   immediately — the classic "user alt-tabs away mid-hold, the app
 *   never sees `keyup`" stuck-recording bug.
 * - a `keydown` with no matching `keyup` within `lostKeyupTimeoutMs`
 *   (default 5000) releases anyway — belt-and-braces for platforms that
 *   sometimes swallow `keyup` outright (e.g. some IME/OS key-repeat
 *   interactions) even while still focused.
 */

import type { HotkeySpec } from "./types/contract";

/**
 * Thrown by `matchesHotkeySpec`/`HotkeyMachine`'s constructor for a spec
 * string that matches neither a `SINGLE_KEY_CODES` alias nor the combo
 * format (`"Mod+Mod+Key"`). Deliberately loud (was previously a silent
 * "matches nothing" fallback, `[fixed per REJECT-FIX M2]`) — a typo'd or
 * unsupported hotkey spec must surface immediately at bind time, not
 * quietly never fire.
 */
export class UnrecognizedHotkeySpecError extends Error {
  constructor(spec: string) {
    super(
      `Unrecognized hotkey spec "${spec}" — expected a single-key alias (see SINGLE_KEY_CODES, mirrors ` +
        `voxis_core::hotkey::KEY_TABLE) or a "Mod+Mod+Key" combo (e.g. "Cmd+Shift+V")`
    );
    this.name = "UnrecognizedHotkeySpecError";
  }
}

/**
 * Mirrors `crates/voxis-core/src/hotkey/mod.rs`'s `KEY_TABLE` (as of the
 * `[R1-Migration S6]` rdev-feature move) alias-by-alias, translated from
 * rdev `Key` variants to `KeyboardEvent.code` values `[fixed per
 * REJECT-FIX M2 — previously only the 8 single-modifier aliases were
 * mirrored, silently dropping every F-key/common-key alias the Rust
 * parser accepts]`. `__tests__/hotkey.test.ts`'s
 * `RUST_KEY_TABLE_FIXTURE` is a second, independent transcription of the
 * same Rust table (not derived from this one) so a future edit to either
 * side that isn't mirrored in the other fails that test.
 */
const SINGLE_KEY_CODES: Record<string, string> = {
  // Modifiers (mod.rs KEY_TABLE ids 1-8).
  alt_r: "AltRight",
  alt_gr: "AltRight",
  altgr: "AltRight",
  ctrl_r: "ControlRight",
  control_r: "ControlRight",
  shift_r: "ShiftRight",
  alt_l: "AltLeft",
  alt: "AltLeft",
  ctrl_l: "ControlLeft",
  ctrl: "ControlLeft",
  control_l: "ControlLeft",
  control: "ControlLeft",
  shift_l: "ShiftLeft",
  shift: "ShiftLeft",
  super_r: "MetaRight",
  cmd_r: "MetaRight",
  meta_r: "MetaRight",
  super_l: "MetaLeft",
  super: "MetaLeft",
  cmd_l: "MetaLeft",
  cmd: "MetaLeft",
  meta_l: "MetaLeft",
  meta: "MetaLeft",
  // Function keys (ids 11-22).
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",
  // Common keys (ids 30-45).
  space: "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  home: "Home",
  end: "End",
  page_up: "PageUp",
  pageup: "PageUp",
  page_down: "PageDown",
  pagedown: "PageDown",
  caps_lock: "CapsLock",
  capslock: "CapsLock",
  insert: "Insert",
  pause: "Pause",
  print_screen: "PrintScreen",
  printscreen: "PrintScreen",
  scroll_lock: "ScrollLock",
  scrolllock: "ScrollLock",
  num_lock: "NumLock",
  numlock: "NumLock",
};

interface ParsedCombo {
  /** Modifiers that must be held (checked via the event's own `ctrlKey`/`altKey`/`shiftKey`/`metaKey`, side-agnostic — `HotkeyCombo::parse`'s format doesn't distinguish sides). */
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** The trailing, non-modifier key, matched case-insensitively against `KeyboardEvent.key`. */
  key: string;
}

function parseCombo(spec: string): ParsedCombo | null {
  const parts = spec.split("+").map((p) => p.trim());
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1];
  if (!key) return null;
  const combo: ParsedCombo = { ctrl: false, alt: false, shift: false, meta: false, key };
  for (const mod of parts.slice(0, -1)) {
    switch (mod.toLowerCase()) {
      case "ctrl":
      case "control":
        combo.ctrl = true;
        break;
      case "alt":
      case "option":
        combo.alt = true;
        break;
      case "shift":
        combo.shift = true;
        break;
      case "cmd":
      case "meta":
      case "super":
        combo.meta = true;
        break;
      default:
        return null;
    }
  }
  return combo;
}

/**
 * A spec's press/release predicates — split in two because a combo's
 * *release* rule is deliberately not "the same predicate as press"
 * (`[fixed per REJECT-FIX M3]`, see `buildMatcher`'s doc comment below).
 * Single-key specs use the same test for both.
 */
export interface HotkeyMatcher {
  press(e: KeyboardEvent): boolean;
  release(e: KeyboardEvent): boolean;
}

/**
 * Builds a `HotkeyMatcher` for a `HotkeySpec.key` string — either a
 * single-key alias (`"alt_r"`, `"f5"`, `"space"`, see `SINGLE_KEY_CODES`,
 * desktop rdev parity) or a combo (`"Cmd+Shift+V"`). Throws
 * `UnrecognizedHotkeySpecError` for anything else — fails *loud*, not
 * "silently matches nothing" (`[fixed per REJECT-FIX M2]`).
 *
 * Combo release rule (`[fixed per REJECT-FIX M3]`): releasing a
 * multi-key combo in the real world practically never means "every key
 * came up in the same event" — a user holding Ctrl+Shift+V commonly
 * lifts Ctrl (or Shift) a few ms before V. Requiring the *press*
 * predicate (all modifiers still down AND the main key) to also match
 * on `keyup` means the very first, most common release order never
 * matches at all — recording would stay "on" until `HotkeyMachine`'s 5s
 * lost-keyup timer finally cuts it. Instead, `release` fires on the
 * **first** keyup of *any* key that is part of the combo (a required
 * modifier, by its side-agnostic `KeyboardEvent.key` value —
 * `"Control"`/`"Alt"`/`"Shift"`/`"Meta"` covers both left/right — or the
 * main key itself), matching `HotkeyMachine.release()`'s own
 * idempotency (a second keyup from another combo member is a no-op,
 * `pressed` is already `false`).
 */
function buildMatcher(spec: string): HotkeyMatcher {
  const singleCode = SINGLE_KEY_CODES[spec.toLowerCase()];
  if (singleCode) {
    const test = (e: KeyboardEvent) => e.code === singleCode;
    return { press: test, release: test };
  }
  const combo = parseCombo(spec);
  if (combo) {
    const press = (e: KeyboardEvent) =>
      e.ctrlKey === combo.ctrl &&
      e.altKey === combo.alt &&
      e.shiftKey === combo.shift &&
      e.metaKey === combo.meta &&
      e.key.toLowerCase() === combo.key.toLowerCase();
    const release = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === combo.key.toLowerCase()) return true;
      if (combo.ctrl && e.key === "Control") return true;
      if (combo.alt && e.key === "Alt") return true;
      if (combo.shift && e.key === "Shift") return true;
      if (combo.meta && e.key === "Meta") return true;
      return false;
    };
    return { press, release };
  }
  throw new UnrecognizedHotkeySpecError(spec);
}

/**
 * The `press` half of `buildMatcher(spec)` — kept as a standalone export
 * for callers/tests that only need "does this keydown match the spec".
 * Throws `UnrecognizedHotkeySpecError` for an unrecognized spec, same as
 * `buildMatcher`/`HotkeyMachine`'s constructor.
 */
export function matchesHotkeySpec(spec: string): (e: KeyboardEvent) => boolean {
  return buildMatcher(spec).press;
}

export interface HotkeyMachineOptions {
  /** `HotkeySpec.key`, or a caller-supplied predicate for tests. */
  matches: string | ((e: KeyboardEvent) => boolean);
  onPressed(): void;
  onReleased(): void;
  /** Default 5000 — see module doc comment. */
  lostKeyupTimeoutMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Pure Pressed/Released machine — no DOM listeners of its own, see
 * `bindHotkey`. Throws `UnrecognizedHotkeySpecError` at construction for
 * an unrecognized `opts.matches` string spec (`[fixed per REJECT-FIX
 * M2]`) — never silently builds a machine that can't ever fire.
 */
export class HotkeyMachine {
  private readonly matchesPress: (e: KeyboardEvent) => boolean;
  private readonly matchesRelease: (e: KeyboardEvent) => boolean;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private pressed = false;
  private lostKeyupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: HotkeyMachineOptions) {
    if (typeof opts.matches === "string") {
      const matcher = buildMatcher(opts.matches); // throws UnrecognizedHotkeySpecError for a bad spec
      this.matchesPress = matcher.press;
      this.matchesRelease = matcher.release;
    } else {
      // A caller-supplied raw predicate (tests) has no separate combo
      // press/release semantics to split — same function for both.
      this.matchesPress = opts.matches;
      this.matchesRelease = opts.matches;
    }
    this.setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  }

  get isPressed(): boolean {
    return this.pressed;
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (!this.matchesPress(e)) return;
    if (e.repeat) return; // auto-repeat must never re-fire "pressed"
    if (this.pressed) return;
    this.pressed = true;
    this.armLostKeyupTimer();
    this.opts.onPressed();
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (!this.matchesRelease(e)) return;
    this.release();
  }

  handleBlur(): void {
    this.release();
  }

  handleVisibilityChange(hidden: boolean): void {
    if (hidden) this.release();
  }

  /** For tests/callers that want to force a release without a real event (e.g. `pagehide`). */
  forceRelease(): void {
    this.release();
  }

  destroy(): void {
    this.clearLostKeyupTimer();
  }

  private armLostKeyupTimer(): void {
    this.clearLostKeyupTimer();
    this.lostKeyupTimer = this.setTimeoutFn(() => {
      this.lostKeyupTimer = null;
      this.release();
    }, this.opts.lostKeyupTimeoutMs ?? 5000);
  }

  private clearLostKeyupTimer(): void {
    if (this.lostKeyupTimer !== null) {
      this.clearTimeoutFn(this.lostKeyupTimer);
      this.lostKeyupTimer = null;
    }
  }

  private release(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.clearLostKeyupTimer();
    this.opts.onReleased();
  }
}

export interface BoundHotkey {
  destroy(): void;
}

/**
 * Wires a `HotkeyMachine` to `document`/`window` — `keydown`/`keyup` on
 * `document`, plus `blur` and `visibilitychange` on `window`/`document`
 * respectively. Only meaningful for `HotkeySpec.mode === "hold"`
 * (`"toggle"` still gets press/release events from the same machine —
 * the caller decides what a "pressed" edge means for its mode, this
 * module doesn't special-case `mode` at all).
 */
export function bindHotkey(
  spec: HotkeySpec,
  handlers: { onPressed(): void; onReleased(): void },
  target: { document: Document; window: Window } = { document, window }
): BoundHotkey {
  const machine = new HotkeyMachine({
    matches: spec.key,
    onPressed: handlers.onPressed,
    onReleased: handlers.onReleased,
  });

  const onKeyDown = (e: Event) => machine.handleKeyDown(e as KeyboardEvent);
  const onKeyUp = (e: Event) => machine.handleKeyUp(e as KeyboardEvent);
  const onBlur = () => machine.handleBlur();
  const onVisibilityChange = () => machine.handleVisibilityChange(target.document.hidden);
  const onPageHide = () => machine.forceRelease();

  target.document.addEventListener("keydown", onKeyDown);
  target.document.addEventListener("keyup", onKeyUp);
  target.window.addEventListener("blur", onBlur);
  target.document.addEventListener("visibilitychange", onVisibilityChange);
  target.window.addEventListener("pagehide", onPageHide);

  return {
    destroy() {
      machine.destroy();
      target.document.removeEventListener("keydown", onKeyDown);
      target.document.removeEventListener("keyup", onKeyUp);
      target.window.removeEventListener("blur", onBlur);
      target.document.removeEventListener("visibilitychange", onVisibilityChange);
      target.window.removeEventListener("pagehide", onPageHide);
    },
  };
}
