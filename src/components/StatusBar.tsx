import { useRecording } from "../hooks/useRecording";
import { useEffect, useState } from "react";
import { getConfig } from "../lib/commands";
import {
  getStatusClass,
  getStatusText,
  getStatusIcon,
  formatHotkeySimple,
  RecordingState,
} from "../lib/status";

interface StatusBarProps {
  hotkey?: string;
}

function StatusBar({ hotkey: propHotkey }: StatusBarProps) {
  const { state, error } = useRecording();
  const [hotkey, setHotkey] = useState(propHotkey || "Ctrl+R");

  useEffect(() => {
    if (!propHotkey) {
      getConfig().then((config) => {
        setHotkey(formatHotkeySimple(config.hotkey));
      });
    }
  }, [propHotkey]);

  // Use shared status utilities
  const statusClass = getStatusClass(state as RecordingState, error);
  const statusText = getStatusText({ state: state as RecordingState, error, hotkey });
  const statusIcon = getStatusIcon(state as RecordingState, error);

  return (
    <div className={`status-bar ${statusClass}`}>
      <span>{statusIcon} {statusText}</span>
    </div>
  );
}

export default StatusBar;
