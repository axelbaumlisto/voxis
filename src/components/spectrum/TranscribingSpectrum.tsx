const BAR_COUNT = 32;

interface TranscribingSpectrumProps {
  pulsePhase: number;
}

function TranscribingSpectrum({ pulsePhase }: TranscribingSpectrumProps) {
  return (
    <div className="spectrum transcribing">
      {Array(BAR_COUNT)
        .fill(0)
        .map((_, i) => {
          const wave = Math.sin(pulsePhase + i * 0.3) * 0.3 + 0.5;
          return (
            <div
              key={i}
              className="spectrum-bar pulse"
              style={{ height: `${wave * 100}%` }}
            />
          );
        })}
    </div>
  );
}

export default TranscribingSpectrum;
