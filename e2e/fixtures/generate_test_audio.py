#!/usr/bin/env python3
"""Generate synthetic audio samples for FFT spectrum analyzer testing.

Generates WAV files with pure sine waves at known frequencies:
- bass_200hz.wav: 200 Hz (voice fundamental, bars 3-5)
- mid_1000hz.wav: 1000 Hz (midrange, bars 12-15)
- high_8000hz.wav: 8000 Hz (sibilants, bars 25-28)
- hello_speech.wav: Mix of frequencies (simulates speech)

Also outputs raw f32 samples as JSON for Rust unit tests.

Note: This script uses only Python standard library (no numpy required).
"""

import json
import math
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 44100
DURATION = 0.5  # seconds
FFT_SIZE = 1024


def generate_sine(freq: float, duration: float = DURATION) -> list[float]:
    """Generate pure sine wave at given frequency."""
    num_samples = int(SAMPLE_RATE * duration)
    return [
        math.sin(2 * math.pi * freq * i / SAMPLE_RATE) for i in range(num_samples)
    ]


def generate_hello_speech() -> list[float]:
    """Generate synthetic 'hello' speech pattern.

    Voice characteristics:
    - Fundamental: 100-200 Hz
    - Formants (vowels): 500-2000 Hz
    """
    num_samples = int(SAMPLE_RATE * DURATION)
    samples = []

    for i in range(num_samples):
        t = i / SAMPLE_RATE
        # E vowel: 200 Hz fundamental + formants at 500, 1500 Hz
        e = (
            0.5 * math.sin(2 * math.pi * 200 * t)
            + 0.3 * math.sin(2 * math.pi * 500 * t)
            + 0.2 * math.sin(2 * math.pi * 1500 * t)
        )

        # Simple envelope
        env_pos = i / num_samples
        if env_pos < 0.2:
            env = env_pos / 0.2  # Attack
        elif env_pos > 0.8:
            env = (1.0 - env_pos) / 0.2  # Release
        else:
            env = 1.0  # Sustain

        samples.append(e * env)

    return samples


def save_wav(filename: Path, samples: list[float]):
    """Save samples as 16-bit WAV file."""
    with wave.open(str(filename), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)  # 16-bit
        wav.setframerate(SAMPLE_RATE)

        # Convert float [-1, 1] to int16
        int_samples = [int(max(-32767, min(32767, s * 32767))) for s in samples]
        wav.writeframes(struct.pack(f"<{len(int_samples)}h", *int_samples))


def save_samples_json(filename: Path, samples: list[float]):
    """Save last FFT_SIZE samples as JSON for Rust tests."""
    # Take last FFT_SIZE samples
    recent = samples[-FFT_SIZE:]
    with open(filename, "w") as f:
        json.dump(
            {"sample_rate": SAMPLE_RATE, "fft_size": FFT_SIZE, "samples": recent}, f
        )


def main():
    output_dir = Path(__file__).parent / "audio"
    output_dir.mkdir(exist_ok=True)

    # Generate test signals
    test_signals = {
        "bass_200hz": generate_sine(200),
        "mid_1000hz": generate_sine(1000),
        "high_8000hz": generate_sine(8000),
        "hello_speech": generate_hello_speech(),
    }

    # Expected bar ranges for each signal (approximate)
    expected_bars = {
        "bass_200hz": {
            "primary_bars": [4, 5, 6],
            "description": "Bass (200 Hz) -> bars 4-6",
        },
        "mid_1000hz": {
            "primary_bars": [14, 15, 16],
            "description": "Mid (1000 Hz) -> bars 14-16",
        },
        "high_8000hz": {
            "primary_bars": [26, 27, 28],
            "description": "High (8000 Hz) -> bars 26-28",
        },
        "hello_speech": {
            "primary_bars": [4, 5, 6, 10, 11, 12],
            "description": "Voice (100-1500 Hz) -> bars 4-12",
        },
    }

    for name, samples in test_signals.items():
        # Save WAV
        save_wav(output_dir / f"{name}.wav", samples)

        # Save JSON for Rust
        save_samples_json(output_dir / f"{name}.json", samples)

        print(f"Generated {name}: {expected_bars[name]['description']}")

    # Save expected bars for test validation
    with open(output_dir / "expected_bars.json", "w") as f:
        json.dump(expected_bars, f, indent=2)

    print(f"\nGenerated {len(test_signals)} test audio files in {output_dir}")


if __name__ == "__main__":
    main()
