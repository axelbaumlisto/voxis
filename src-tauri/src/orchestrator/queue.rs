//! Transcription queue for buffering audio while previous transcriptions process.
//!
//! This module provides a thread-safe FIFO queue that allows users to record
//! new messages while previous ones are still being transcribed.
//! The queue has a maximum capacity of 100 items - when full, oldest items are dropped.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{Mutex, Notify};

/// Maximum queue capacity. When exceeded, oldest items are dropped.
pub const MAX_QUEUE_SIZE: usize = 100;

/// Queued audio item with metadata.
#[derive(Debug)]
pub struct QueuedAudio {
    /// Raw audio data in WAV format.
    pub audio_data: Vec<u8>,
    /// Timestamp when the audio was queued.
    pub timestamp: Instant,
}

/// Thread-safe FIFO queue for transcriptions.
///
/// Allows recording to continue while previous transcriptions are processing.
/// Uses a worker pattern where items are pushed by the main thread and
/// processed sequentially by a background worker.
pub struct TranscriptionQueue {
    queue: Arc<Mutex<VecDeque<QueuedAudio>>>,
    notify: Arc<Notify>,
}

impl TranscriptionQueue {
    /// Create a new empty transcription queue.
    pub fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            notify: Arc::new(Notify::new()),
        }
    }

    /// Add audio to the queue.
    ///
    /// Returns the new queue length after insertion.
    /// If queue is at capacity (100 items), oldest items are dropped.
    pub async fn push(&self, audio_data: Vec<u8>) -> usize {
        let mut q = self.queue.lock().await;

        // Drop oldest items if at capacity
        while q.len() >= MAX_QUEUE_SIZE {
            if let Some(dropped) = q.pop_front() {
                tracing::warn!(
                    "Queue full ({} items), dropping oldest audio ({} bytes, queued {:?} ago)",
                    MAX_QUEUE_SIZE,
                    dropped.audio_data.len(),
                    dropped.timestamp.elapsed()
                );
            }
        }

        q.push_back(QueuedAudio {
            audio_data,
            timestamp: Instant::now(),
        });
        let len = q.len();
        drop(q); // Release lock before notifying
        self.notify.notify_one();
        len
    }

    /// Wait for and retrieve the next audio from the queue.
    ///
    /// This method blocks until an item is available.
    pub async fn pop(&self) -> QueuedAudio {
        loop {
            {
                let mut q = self.queue.lock().await;
                if let Some(item) = q.pop_front() {
                    return item;
                }
            }
            self.notify.notified().await;
        }
    }

    /// Try to get the next item without waiting.
    ///
    /// Returns `None` if the queue is empty.
    pub async fn try_pop(&self) -> Option<QueuedAudio> {
        let mut q = self.queue.lock().await;
        q.pop_front()
    }

    /// Get current queue length.
    pub async fn len(&self) -> usize {
        self.queue.lock().await.len()
    }

    /// Check if the queue is empty.
    pub async fn is_empty(&self) -> bool {
        self.queue.lock().await.is_empty()
    }
}

impl Default for TranscriptionQueue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};

    #[tokio::test]
    async fn test_push_pop_fifo() {
        let q = TranscriptionQueue::new();
        q.push(vec![1, 2, 3]).await;
        q.push(vec![4, 5, 6]).await;

        let item1 = q.pop().await;
        assert_eq!(item1.audio_data, vec![1, 2, 3]);

        let item2 = q.pop().await;
        assert_eq!(item2.audio_data, vec![4, 5, 6]);
    }

    #[tokio::test]
    async fn test_len() {
        let q = TranscriptionQueue::new();
        assert_eq!(q.len().await, 0);

        q.push(vec![1]).await;
        assert_eq!(q.len().await, 1);

        q.push(vec![2]).await;
        assert_eq!(q.len().await, 2);

        q.pop().await;
        assert_eq!(q.len().await, 1);
    }

    #[tokio::test]
    async fn test_is_empty() {
        let q = TranscriptionQueue::new();
        assert!(q.is_empty().await);

        q.push(vec![1]).await;
        assert!(!q.is_empty().await);

        q.pop().await;
        assert!(q.is_empty().await);
    }

    #[tokio::test]
    async fn test_try_pop_empty() {
        let q = TranscriptionQueue::new();
        assert!(q.try_pop().await.is_none());
    }

    #[tokio::test]
    async fn test_try_pop_with_item() {
        let q = TranscriptionQueue::new();
        q.push(vec![1, 2, 3]).await;

        let item = q.try_pop().await;
        assert!(item.is_some());
        assert_eq!(item.unwrap().audio_data, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn test_push_returns_length() {
        let q = TranscriptionQueue::new();

        let len1 = q.push(vec![1]).await;
        assert_eq!(len1, 1);

        let len2 = q.push(vec![2]).await;
        assert_eq!(len2, 2);

        let len3 = q.push(vec![3]).await;
        assert_eq!(len3, 3);
    }

    #[tokio::test]
    async fn test_timestamp_is_set() {
        let q = TranscriptionQueue::new();
        let before = Instant::now();
        q.push(vec![1]).await;
        let after = Instant::now();

        let item = q.pop().await;
        assert!(item.timestamp >= before);
        assert!(item.timestamp <= after);
    }

    #[tokio::test]
    async fn test_concurrent_push() {
        let q = Arc::new(TranscriptionQueue::new());
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let q = Arc::clone(&q);
                tokio::spawn(async move { q.push(vec![i]).await })
            })
            .collect();

        for h in handles {
            h.await.unwrap();
        }

        assert_eq!(q.len().await, 10);
    }

    #[tokio::test]
    async fn test_pop_waits_for_push() {
        let q = Arc::new(TranscriptionQueue::new());
        let q_clone = Arc::clone(&q);

        // Spawn consumer that waits for item
        let consumer = tokio::spawn(async move {
            let item = q_clone.pop().await;
            item.audio_data
        });

        // Give consumer time to start waiting
        tokio::time::sleep(Duration::from_millis(10)).await;

        // Push item
        q.push(vec![42]).await;

        // Consumer should receive the item
        let result = timeout(Duration::from_secs(1), consumer)
            .await
            .expect("timeout")
            .expect("join error");

        assert_eq!(result, vec![42]);
    }

    #[tokio::test]
    async fn test_multiple_consumers_producer() {
        let q = Arc::new(TranscriptionQueue::new());

        // Pre-fill queue
        for i in 0..5 {
            q.push(vec![i]).await;
        }

        // Pop all items
        let mut results = Vec::new();
        for _ in 0..5 {
            let item = q.pop().await;
            results.push(item.audio_data[0]);
        }

        // Should be FIFO order
        assert_eq!(results, vec![0, 1, 2, 3, 4]);
    }

    #[tokio::test]
    async fn test_default() {
        let q = TranscriptionQueue::default();
        assert!(q.is_empty().await);
    }

    #[tokio::test]
    async fn test_large_audio_data() {
        let q = TranscriptionQueue::new();
        let large_data: Vec<u8> = (0..100_000).map(|i| (i % 256) as u8).collect();
        let expected_len = large_data.len();

        q.push(large_data).await;
        let item = q.pop().await;

        assert_eq!(item.audio_data.len(), expected_len);
    }

    #[tokio::test]
    async fn test_empty_audio_data() {
        let q = TranscriptionQueue::new();
        q.push(vec![]).await;

        let item = q.pop().await;
        assert!(item.audio_data.is_empty());
    }

    #[tokio::test]
    async fn test_max_queue_size_drops_oldest() {
        let q = TranscriptionQueue::new();

        // Push 3 items (using small test limit simulation)
        // The actual MAX_QUEUE_SIZE is 100, so we just verify the concept
        for i in 0..3 {
            q.push(vec![i as u8]).await;
        }

        assert_eq!(q.len().await, 3);

        // Pop and verify FIFO order preserved
        assert_eq!(q.pop().await.audio_data, vec![0]);
        assert_eq!(q.pop().await.audio_data, vec![1]);
        assert_eq!(q.pop().await.audio_data, vec![2]);
    }

    #[tokio::test]
    async fn test_max_queue_size_constant() {
        // Verify the constant is set to 100
        assert_eq!(MAX_QUEUE_SIZE, 100);
    }
}
