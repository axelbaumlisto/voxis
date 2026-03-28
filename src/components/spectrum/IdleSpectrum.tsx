const BAR_COUNT = 32;

function IdleSpectrum() {
  return (
    <div className="spectrum idle">
      {Array(BAR_COUNT)
        .fill(0)
        .map((_, i) => (
          <div key={i} className="spectrum-bar" style={{ height: "2px" }} />
        ))}
    </div>
  );
}

export default IdleSpectrum;
