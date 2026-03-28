import { createContext, useContext, ReactNode } from "react";
import { useRecording, UseRecordingResult } from "../hooks/useRecording";

const RecordingContext = createContext<UseRecordingResult | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const recording = useRecording();
  return (
    <RecordingContext.Provider value={recording}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext(): UseRecordingResult {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error("useRecordingContext must be used within RecordingProvider");
  }
  return context;
}
