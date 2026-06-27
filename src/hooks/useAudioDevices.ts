import { useState, useEffect, useMemo } from "react";
import { listAudioDevices, AudioDevice } from "../lib/commands";
import { SettingOption } from "../lib/settingsRegistry";
import { getErrorMessage } from "../lib/errors";

/**
 * Hook for loading and managing audio devices.
 * SRP: Extracts audio device loading logic from SettingsPage.
 */
export function useAudioDevices(currentDevice: string | undefined) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAudioDevices()
      .then((devs) => setDevices(devs ?? []))
      .catch((err) => {
        console.error("Failed to load audio devices:", err);
        setError(getErrorMessage(err));
        // Graceful fallback - show only "Default" option when permission denied
        setDevices([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const options: SettingOption[] = useMemo(() => {
    const opts: SettingOption[] = [{ label: "Default", value: "default" }];

    for (const device of devices) {
      if (device.id !== "default") {
        opts.push({ label: device.name, value: device.id });
      }
    }

    // Add current device if not already in list (e.g., device was disconnected)
    if (currentDevice && currentDevice !== "default") {
      const exists = opts.some((opt) => opt.value === currentDevice);
      if (!exists) {
        opts.push({ label: `${currentDevice} (current)`, value: currentDevice });
      }
    }

    return opts;
  }, [devices, currentDevice]);

  return { devices, options, loading, error };
}
