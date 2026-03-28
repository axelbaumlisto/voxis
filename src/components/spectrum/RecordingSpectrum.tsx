interface RecordingSpectrumProps {
  bins: number[];
  useGradient: boolean;
}

function RecordingSpectrum({ bins, useGradient }: RecordingSpectrumProps) {
  const gradientClass = useGradient ? "gradient" : "";
  return (
    <div className={`spectrum recording ${gradientClass}`}>
      {bins.map((level, i) => {
        // Amplify for visibility (bins are 0-1, but typically low)
        const amplified = Math.min(1.0, Math.pow(level * 4, 0.6));
        return (
          <div
            key={i}
            className="spectrum-bar"
            style={{ height: `${Math.max(2, amplified * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

export default RecordingSpectrum;
