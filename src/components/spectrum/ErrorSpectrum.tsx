const BAR_COUNT = 32;

function ErrorSpectrum() {
  return (
    <div className="spectrum error">
      {Array(BAR_COUNT)
        .fill(0)
        .map((_, i) => {
          const random = Math.random() * 0.5 + 0.3;
          return (
            <div
              key={i}
              className="spectrum-bar error"
              style={{ height: `${random * 100}%` }}
            />
          );
        })}
    </div>
  );
}

export default ErrorSpectrum;
