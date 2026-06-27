/**
 * OnboardingPage — first-run wizard (#10).
 *
 * 3 sequential steps in one stateful component:
 *   1. Mic permission test — button + status message.
 *   2. Hotkey reminder    — explain default + link to Settings.
 *   3. First transcription — ask user to press AltGr and dictate.
 *
 * Gated by `commands.isFirstRun()` in App.tsx; clicking "Done" on the
 * last step fires `commands.markFirstRunComplete()`.
 *
 * KISS: no router sub-paths. The step index lives in local state. A
 * single render branch per step keeps the file under 200 LoC.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { commands } from "../bindings";
import { unwrapResult } from "../lib/commandResult";

type Step = 0 | 1 | 2;

// Step label keys — the `{i+1}.` number is interpolated separately, so only the
// label text is translated. Reused for the per-step heading ("Step N · <label>").
const STEP_LABEL_KEYS = [
  "onboarding.stepMicrophone",
  "onboarding.stepHotkey",
  "onboarding.stepTryIt",
] as const;

function StepNav({ step }: { step: Step }) {
  const { t } = useTranslation();
  return (
    <ol style={{ display: "flex", gap: 16, listStyle: "none", padding: 0 }}>
      {STEP_LABEL_KEYS.map((labelKey, i) => (
        <li
          key={labelKey}
          data-testid={`onboarding-step-indicator-${i}`}
          style={{
            opacity: i === step ? 1 : 0.5,
            fontWeight: i === step ? 600 : 400,
            borderBottom: i === step ? "2px solid var(--accent)" : "none",
            paddingBottom: 4,
          }}
        >
          {i + 1}. {t(labelKey)}
        </li>
      ))}
    </ol>
  );
}

export default function OnboardingPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(0);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const navigate = useNavigate();

  const onTestMic = async () => {
    try {
      // The simplest possible self-test: try to list input devices.
      // If the OS denies mic permission, this throws.
      // The full live waveform test is a stretch goal.
      await commands.listAudioDevices();
      setMicStatus(t("onboarding.micGranted"));
    } catch (e) {
      setMicStatus(
        t("onboarding.micFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };

  const onDone = async () => {
    try {
      unwrapResult(await commands.markFirstRunComplete());
      navigate("/");
    } catch (e) {
      console.error("markFirstRunComplete failed:", e);
      // Navigate anyway — the user shouldn't be trapped on the
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
      <h1>{t("onboarding.welcome")}</h1>
      <StepNav step={step} />

      {step === 0 && (
        <section data-testid="onboarding-step-mic">
          <h2>
            {t("onboarding.stepHeading", {
              number: 1,
              label: t("onboarding.stepMicrophone"),
            })}
          </h2>
          <p>{t("onboarding.micBody")}</p>
          <button
            type="button"
            data-testid="onboarding-test-mic"
            onClick={() => void onTestMic()}
          >
            {t("onboarding.testMicrophone")}
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
              {t("onboarding.next")}
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section data-testid="onboarding-step-hotkey">
          <h2>
            {t("onboarding.stepHeading", {
              number: 2,
              label: t("onboarding.stepHotkey"),
            })}
          </h2>
          <p>
            <Trans i18nKey="onboarding.hotkeyBody" components={{ code: <code /> }} />
          </p>
          <p>{t("onboarding.hotkeyBodySettings")}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button
              type="button"
              data-testid="onboarding-back-1"
              onClick={() => setStep(0)}
            >
              {t("onboarding.back")}
            </button>
            <button
              type="button"
              data-testid="onboarding-next-1"
              onClick={() => setStep(2)}
            >
              {t("onboarding.next")}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section data-testid="onboarding-step-try">
          <h2>
            {t("onboarding.stepHeading", {
              number: 3,
              label: t("onboarding.stepTryIt"),
            })}
          </h2>
          <p>
            <Trans i18nKey="onboarding.tryBody" components={{ code: <code /> }} />
          </p>
          <p>{t("onboarding.tryBodyGlow")}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button
              type="button"
              data-testid="onboarding-back-2"
              onClick={() => setStep(1)}
            >
              {t("onboarding.back")}
            </button>
            <button
              type="button"
              data-testid="onboarding-done"
              onClick={() => void onDone()}
            >
              {t("onboarding.done")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
