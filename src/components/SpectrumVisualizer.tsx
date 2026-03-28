import { useEffect, useRef, useState } from "react";
import { getSpectrumBins } from "../lib/commands";
import IdleSpectrum from "./spectrum/IdleSpectrum";
import RecordingSpectrum from "./spectrum/RecordingSpectrum";
import TranscribingSpectrum from "./spectrum/TranscribingSpectrum";
import ErrorSpectrum from "./spectrum/ErrorSpectrum";
import "../styles/spectrum.css";

const BAR_COUNT = 32;
const ANIMATION_INTERVAL = 50; // ms - faster for smoother animation

interface SpectrumVisualizerProps {
  mode: "idle" | "recording" | "transcribing" | "error";
  useGradient?: boolean;
}

function SpectrumVisualizer({ mode, useGradient = false }: SpectrumVisualizerProps) {
  const [bins, setBins] = useState<number[]>(Array(BAR_COUNT).fill(0));
  const [pulsePhase, setPulsePhase] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    console.log("[SpectrumVisualizer] mode changed to:", mode);
    intervalRef.current = window.setInterval(() => {
      if (mode === "recording") {
        getSpectrumBins()
          .then((newBins) => {
            // Check if any bins have non-zero values
            const hasData = newBins.some((v) => v > 0.01);
            if (hasData) {
              console.log("[SpectrumVisualizer] Got spectrum data:", newBins.slice(0, 5));
            }
            setBins(newBins);
          })
          .catch((err) => {
            console.error("[SpectrumVisualizer] Error:", err);
          });
      } else if (mode === "transcribing") {
        setPulsePhase((prev) => prev + 0.2);
      }
    }, ANIMATION_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [mode]);

  // Reset when mode changes
  useEffect(() => {
    setBins(Array(BAR_COUNT).fill(0));
    setPulsePhase(0);
  }, [mode]);

  switch (mode) {
    case "idle":
      return <IdleSpectrum />;
    case "recording":
      return <RecordingSpectrum bins={bins} useGradient={useGradient} />;
    case "transcribing":
      return <TranscribingSpectrum pulsePhase={pulsePhase} />;
    case "error":
      return <ErrorSpectrum />;
  }
}

export default SpectrumVisualizer;
