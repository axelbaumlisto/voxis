/**
 * OnboardingPage \u2014 first-run wizard (#10).
 *
 * 3 sequential steps in one stateful component:
 *   1. Mic permission test \u2014 button + status message.
 *   2. Hotkey reminder    \u2014 explain default + link to Settings.
 *   3. First transcription \u2014 ask user to press AltGr and dictate.
 *
 * Gated by `commands.isFirstRun()` in App.tsx; clicking "Done" on the
 * last step fires `commands.markFirstRunComplete()`.
 *
 * KISS: no router sub-paths. The step index lives in local state. A
 * single render branch per step keeps the file under 200 LoC.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { commands } from "../bindings";

type Step = 0 | 1 | 2;

function unwrap<T>(result: { status: string; data?: T; error?: unknown }): T {
  if (result.status !== "ok") {
    throw new Error(String(result.error ?? "command failed"));
  }
  return result.data as T;
}

function StepNav({ step }: { step: Step }) {
  return (
    <ol style={{ display: "flex", gap: 16, listStyle: "none", padding: 0 }}>
      {(["Microphone", "Hotkey", "Try it"] as const).map((label, i) => (
        <li
          key={label}
          data-testid={`onboarding-step-indicator-${i}`}
          style={{
            opacity: i === step ? 1 : 0.5,
            fontWeight: i === step ? 600 : 400,
            borderBottom: i === step ? "2px solid var(--accent-color, #1e88e5)" : "none",
            paddingBottom: 4,
          }}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>(0);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const navigate = useNavigate();

  const onTestMic = async () => {
    try {
      // The simplest possible self-test: try to list input devices.
      // If the OS denies mic permission, this throws.
      // The full live waveform test is a stretch goal.
      await commands.listAudioDevices();
      setMicStatus("\u2705 Microphone access granted");
    } catch (e) {
      setMicStatus(
        `\u26a0\ufe0f Mic access failed: ${e instanceof Error ? e.message : String(e)}. ` +
          `Open System Settings \u2192 Privacy \u2192 Microphone and enable this app.`,
      );
    }
  };

  const onDone = async () => {
    try {
      unwrap(await commands.markFirstRunComplete());
      navigate("/");
    } catch (e) {
      console.error("markFirstRunComplete failed:", e);
      // Navigate anyway \u2014 the user shouldn't be trapped on the
      // onboarding page because of a one-time persistence glitch.
      navigate("/");
    }
  };

  return (
    <div
      data-testid="onboarding-page"
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "32px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <h1>Welcome to SoupaWhisper</h1>
      <StepNav step={step} />

      {step === 0 && (
        <section data-testid="onboarding-step-mic">
          <h2>Step 1 \u00b7 Microphone</h2>
          <p>
            We need permission to read your microphone. Click below and your
            OS will prompt you if it hasn't already.
          </p>
          <button
            type="button"
            data-testid="onboarding-test-mic"
            onClick={() => void onTestMic()}
          >
            Test microphone
          </button>
          {micStatus && (
            <p data-testid="onboarding-mic-status" style={{ marginTop: 12 }}>
              {micStatus}
            </p>
          )}
          <div style={{ marginTop: 24 }}>
            <button
              type="button"
              data-testid="onboarding-next-0"
              onClick={() => setStep(1)}
            >
              Next \u2192
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section data-testid="onboarding-step-hotkey">
          <h2>Step 2 \u00b7 Hotkey</h2>
          <p>
            By default you hold <code>AltGr</code> (right Alt) to record. The
            pill overlay shows recording state. Release to transcribe and paste.
          </p>
          <p>
            You can change the key or add per-prompt shortcuts later in
            Settings \u2192 Recording.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button
              type="button"
              data-testid="onboarding-back-1"
              onClick={() => setStep(0)}
            >
              \u2190 Back
            </button>
            <button
              type="button"
              data-testid="onboarding-next-1"
              onClick={() => setStep(2)}
            >
              Next \u2192
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section data-testid="onboarding-step-try">
          <h2>Step 3 \u00b7 Try it</h2>
          <p>
            Hold <code>AltGr</code> in any text field and say something. The
            transcription will be pasted automatically when you release.
          </p>
          <p>You'll see the pill overlay glow while recording.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button
              type="button"
              data-testid="onboarding-back-2"
              onClick={() => setStep(1)}
            >
              \u2190 Back
            </button>
            <button
              type="button"
              data-testid="onboarding-done"
              onClick={() => void onDone()}
            >
              Done \u2014 take me to the app
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
