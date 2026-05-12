//! Smoothed VAD decorator with onset, hangover, and prefill.
//!
//! OCP: Wraps any `VoiceActivityDetector` to add temporal smoothing.
//! - **Onset**: Requires N consecutive voice frames before triggering speech.
//! - **Hangover**: Continues speech for N frames after voice stops (avoids mid-word cuts).
//! - **Prefill**: When speech triggers, includes N previous frames (captures word start).

use super::{VadFrame, VoiceActivityDetector};
use anyhow::Result;
use std::collections::VecDeque;

/// Decorator that adds temporal smoothing to any VAD backend.
pub struct SmoothedVad {
    inner: Box<dyn VoiceActivityDetector>,
    prefill_frames: usize,
    hangover_frames: usize,
    onset_frames: usize,

    // State
    frame_buffer: VecDeque<Vec<f32>>,
    hangover_counter: usize,
    onset_counter: usize,
    in_speech: bool,

    /// Temporary buffer for aggregated prefill + current speech output.
    temp_out: Vec<f32>,
}

impl SmoothedVad {
    /// Create a new SmoothedVad wrapping an inner detector.
    ///
    /// - `inner`: The underlying VAD to delegate frame classification to.
    /// - `prefill_frames`: Number of past frames to include when speech starts.
    /// - `hangover_frames`: Number of silence frames to tolerate before ending speech.
    /// - `onset_frames`: Number of consecutive voice frames required to trigger speech.
    pub fn new(
        inner: Box<dyn VoiceActivityDetector>,
        prefill_frames: usize,
        hangover_frames: usize,
        onset_frames: usize,
    ) -> Self {
        Self {
            inner,
            prefill_frames,
            hangover_frames,
            onset_frames,
            frame_buffer: VecDeque::new(),
            hangover_counter: 0,
            onset_counter: 0,
            in_speech: false,
            temp_out: Vec::new(),
        }
    }
}

impl VoiceActivityDetector for SmoothedVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> Result<VadFrame<'a>> {
        // 1. Buffer frame for possible prefill (keep prefill_frames + 1)
        self.frame_buffer.push_back(frame.to_vec());
        while self.frame_buffer.len() > self.prefill_frames + 1 {
            self.frame_buffer.pop_front();
        }

        // 2. Classify via inner VAD
        let is_voice = self.inner.is_voice(frame)?;

        match (self.in_speech, is_voice) {
            // Not in speech, inner says voice → accumulate onset
            (false, true) => {
                self.onset_counter += 1;
                if self.onset_counter >= self.onset_frames {
                    // Enough consecutive voice frames — trigger speech
                    self.in_speech = true;
                    self.hangover_counter = self.hangover_frames;
                    self.onset_counter = 0;

                    // Output prefill + current frame
                    self.temp_out.clear();
                    for buf in &self.frame_buffer {
                        self.temp_out.extend(buf);
                    }
                    Ok(VadFrame::Speech(&self.temp_out))
                } else {
                    Ok(VadFrame::Noise)
                }
            }

            // In speech, inner says voice → continue, reset hangover
            (true, true) => {
                self.hangover_counter = self.hangover_frames;
                Ok(VadFrame::Speech(frame))
            }

            // In speech, inner says noise → hangover countdown
            (true, false) => {
                if self.hangover_counter > 0 {
                    self.hangover_counter -= 1;
                    Ok(VadFrame::Speech(frame))
                } else {
                    self.in_speech = false;
                    Ok(VadFrame::Noise)
                }
            }

            // Not in speech, inner says noise → reset onset
            (false, false) => {
                self.onset_counter = 0;
                Ok(VadFrame::Noise)
            }
        }
    }

    fn reset(&mut self) {
        self.frame_buffer.clear();
        self.hangover_counter = 0;
        self.onset_counter = 0;
        self.in_speech = false;
        self.temp_out.clear();
    }
}
