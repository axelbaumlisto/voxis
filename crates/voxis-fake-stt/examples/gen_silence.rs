//! Generates `fixtures/audio/silence.wav` deterministically (seeded
//! PRNG, `voxis_fake_stt::silence_gen`) — run with
//! `cargo run -p voxis-fake-stt --example gen_silence` from the repo
//! root (or anywhere; the output path is resolved relative to the repo
//! root via `CARGO_MANIFEST_DIR`, not the current working directory).
//! Idempotent: same seed, same bytes, every run — regenerating and
//! `git diff`-ing produces no changes unless `silence_gen`'s parameters
//! change.

use voxis_fake_stt::silence_gen::{generate_samples, SilenceGenParams};

fn main() {
    let params = SilenceGenParams::default();
    let samples = generate_samples(&params);

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: params.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let out_path = manifest_dir.join("../../fixtures/audio/silence.wav");
    std::fs::create_dir_all(out_path.parent().unwrap()).unwrap();

    let mut writer = hound::WavWriter::create(&out_path, spec).expect("create silence.wav writer");
    for sample in &samples {
        let sample_i16 = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer.write_sample(sample_i16).expect("write sample");
    }
    writer.finalize().expect("finalize silence.wav");

    println!("wrote {} ({} samples, {} ms @ {} Hz)", out_path.display(), samples.len(), params.duration_ms, params.sample_rate);
}
