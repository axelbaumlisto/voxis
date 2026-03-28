import { useState, useEffect } from "react";

/**
 * Hook for displaying current time with automatic updates.
 * SRP: Extracts clock logic from Layout.tsx.
 *
 * @param format - Intl.DateTimeFormatOptions for time formatting
 * @returns Formatted time string
 */
export function useClock(
  format: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }
): string {
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-US", format));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [format]);

  return currentTime;
}
