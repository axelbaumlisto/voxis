use std::sync::{Mutex, MutexGuard};

/// Safe mutex lock that recovers from poisoned state.
/// KISS: Centralizes mutex error handling to avoid unwrap() panics.
pub(crate) fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn test_lock_or_recover_normal() {
        let mutex = Mutex::new(42);
        let guard = lock_or_recover(&mutex);
        assert_eq!(*guard, 42);
    }

    #[test]
    fn test_lock_or_recover_poisoned() {
        use std::panic;

        let mutex = Arc::new(Mutex::new(42));
        let mutex_clone = Arc::clone(&mutex);

        // Poison the mutex by panicking while holding the lock
        let _ = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            let _guard = mutex_clone.lock().unwrap();
            panic!("intentional panic to poison mutex");
        }));

        // lock_or_recover should still work
        let guard = lock_or_recover(&mutex);
        assert_eq!(*guard, 42);
    }
}
