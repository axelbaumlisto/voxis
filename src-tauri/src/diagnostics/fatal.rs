//! Fatal signal / exception crash diagnostics.
//!
//! Origin: adapted from Clipshot's proven fatal diagnostics implementation
//! (`/home/sham/work/clipshot/src/diagnostics/fatal.rs`, Task 2 of the
//! always-on crash diagnostics work). Keep this note so future fixes in either
//! repository can be mirrored deliberately.
//!
//! The Unix handler in this module is deliberately tiny and async-signal-safe:
//! it writes one fixed-buffer report to a file descriptor opened during
//! initialization, then restores the default disposition and re-raises the fatal
//! signal. Do not add allocation, formatting machinery, path resolution, file
//! creation, logging, or locks to the handler path.
//!
//! Unix fatal signal handlers are process-wide, so ordinary fatal signals such
//! as SIGABRT or a bad-pointer SIGSEGV can be reported from any thread after
//! [`install`] succeeds. Alternate signal stacks are different: `sigaltstack(2)`
//! is per-thread. [`install`] registers one for the installing thread, and
//! Voxis-owned threads should call [`install_thread_altstack`] at thread start;
//! `lib.rs::run()` covers Tauri/Tokio async runtime workers with Tokio's
//! `on_thread_start` hook. Stack-overflow SIGSEGV reporting is therefore covered
//! for the main thread and Voxis-owned threads that install this per-thread
//! stack. Threads created internally by third-party toolkits/libraries
//! (Tao/GTK/WebKit, rdev internals,
//! cpal internals, etc.) remain a residual gap for stack-overflow crashes,
//! although their non-stack-overflow fatal signals still reach the process-wide
//! handler.

use crate::diagnostics::breadcrumbs::{self, BreadcrumbRecord};
use std::cell::UnsafeCell;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Once;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, AtomicUsize, Ordering};

const VERSION_BUFFER_CAP: usize = 64;
const FATAL_REPORT_BUFFER_CAP: usize = 16 * 1024;
const FATAL_BREADCRUMB_CAP: usize = 80;
const CRASH_LOG_BACKUP_FILE_NAME: &str = "crash.log.1";
const MAX_CRASH_LOG_BYTES: u64 = 1024 * 1024;

#[cfg(test)]
const FATAL_E2E_ENV: &str = "VOXIS_FATAL_E2E";
#[cfg(all(unix, test))]
const FATAL_E2E_CHILD_ENV: &str = "VOXIS_FATAL_E2E_CHILD";
#[cfg(test)]
const FATAL_TEST_CONFIG_DIR_ENV: &str = "VOXIS_FATAL_TEST_CONFIG_DIR";

struct StaticCell<T>(UnsafeCell<T>);

// SAFETY: All mutable access to these statics is constrained by one-time
// initialization or by HANDLING_FATAL's process-wide reentrancy guard. Readers
// publish/observe lengths with atomics before taking immutable slices.
unsafe impl<T> Sync for StaticCell<T> {}

static INIT: Once = Once::new();
static HANDLING_FATAL: AtomicBool = AtomicBool::new(false);
const INSTALL_STEP_RECORDING: u8 = u8::MAX;
static INSTALL_ERROR_STEP: AtomicU8 = AtomicU8::new(InstallStep::None as u8);
static INSTALL_ERROR_OS: AtomicI32 = AtomicI32::new(0);
static VERSION_LEN: AtomicUsize = AtomicUsize::new(0);
static VERSION_BYTES: StaticCell<[u8; VERSION_BUFFER_CAP]> =
    StaticCell(UnsafeCell::new([0; VERSION_BUFFER_CAP]));
static REPORT_BUFFER: StaticCell<[u8; FATAL_REPORT_BUFFER_CAP]> =
    StaticCell(UnsafeCell::new([0; FATAL_REPORT_BUFFER_CAP]));
static BREADCRUMB_BUFFER: StaticCell<[BreadcrumbRecord; FATAL_BREADCRUMB_CAP]> =
    StaticCell(UnsafeCell::new([BreadcrumbRecord::EMPTY; FATAL_BREADCRUMB_CAP]));

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum InstallStep {
    None = 0,
    CrashLog = 1,
    MainThreadAltStack = 2,
    ThreadAltStack = 3,
    Sigaction = 4,
    WindowsExceptionFilter = 5,
}

impl InstallStep {
    fn from_u8(value: u8) -> Option<Self> {
        match value {
            value if value == InstallStep::CrashLog as u8 => Some(InstallStep::CrashLog),
            value if value == InstallStep::MainThreadAltStack as u8 => {
                Some(InstallStep::MainThreadAltStack)
            }
            value if value == InstallStep::ThreadAltStack as u8 => Some(InstallStep::ThreadAltStack),
            value if value == InstallStep::Sigaction as u8 => Some(InstallStep::Sigaction),
            value if value == InstallStep::WindowsExceptionFilter as u8 => {
                Some(InstallStep::WindowsExceptionFilter)
            }
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InstallErrorSnapshot {
    pub step: InstallStep,
    pub os_error: i32,
}

#[derive(Debug)]
struct InstallError {
    step: InstallStep,
    source: io::Error,
}

impl InstallError {
    fn new(step: InstallStep, source: io::Error) -> Self {
        Self { step, source }
    }
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.step, self.source)
    }
}

/// Install fatal crash diagnostics for the current platform.
///
/// This is intentionally best-effort: startup must not fail just because the
/// diagnostics crash log cannot be opened or a handler cannot be registered.
/// Install failures are captured in static atomics queryable via
/// [`last_install_error`], which Task 5 will surface to users.
pub fn install() {
    INIT.call_once(|| {
        // Do not clear a pre-existing install error here: lib.rs creates the
        // Tauri/Tokio runtime before full fatal installation, and its
        // on_thread_start hook may already have observed a per-thread altstack
        // failure that Task 5 must still be able to surface.
        init_version_bytes();

        #[cfg(unix)]
        if let Err(err) = unix::install() {
            record_install_error(err.step, &err.source);
            eprintln!("failed to install fatal signal diagnostics: {err}");
        }

        #[cfg(windows)]
        if let Err(err) = windows::install() {
            record_install_error(err.step, &err.source);
            eprintln!("failed to install fatal exception diagnostics: {err}");
        }
    });
}

/// Return the first fatal-diagnostics installation failure observed in this process.
///
/// This is allocation-free and logging-independent so callers can query it after
/// startup even though [`install`] runs very early.
pub fn last_install_error() -> Option<InstallErrorSnapshot> {
    let step = INSTALL_ERROR_STEP.load(Ordering::Acquire);
    let step = InstallStep::from_u8(step)?;
    Some(InstallErrorSnapshot {
        step,
        os_error: INSTALL_ERROR_OS.load(Ordering::Relaxed),
    })
}

/// Install an alternate signal stack for the current thread.
///
/// On Unix this calls `sigaltstack(2)` for the calling thread only. On non-Unix
/// platforms it is a no-op. Call this at the top of Voxis-owned threads that
/// should be able to report stack-overflow SIGSEGV crashes. The implementation
/// first uses the POSIX query form (`sigaltstack(NULL, &old)`) so reused/pool
/// threads that already have an alternate stack do not leak another 64 KiB.
pub fn install_thread_altstack() -> io::Result<()> {
    #[cfg(unix)]
    {
        unix::install_thread_altstack()
    }

    #[cfg(not(unix))]
    {
        Ok(())
    }
}

/// Best-effort per-thread altstack install for spawned threads.
///
/// Failures are recorded for later diagnostics but never abort the thread.
pub fn install_thread_altstack_best_effort() {
    if let Err(err) = install_thread_altstack() {
        record_install_error(InstallStep::ThreadAltStack, &err);
    }
}

fn record_install_error(step: InstallStep, err: &io::Error) {
    let os_error = err.raw_os_error().unwrap_or(0);
    if INSTALL_ERROR_STEP
        .compare_exchange(
            InstallStep::None as u8,
            INSTALL_STEP_RECORDING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
    {
        INSTALL_ERROR_OS.store(os_error, Ordering::Relaxed);
        INSTALL_ERROR_STEP.store(step as u8, Ordering::Release);
    }
}

#[cfg(test)]
fn clear_install_error() {
    INSTALL_ERROR_OS.store(0, Ordering::Relaxed);
    INSTALL_ERROR_STEP.store(InstallStep::None as u8, Ordering::Release);
}

fn init_version_bytes() {
    let bytes = env!("CARGO_PKG_VERSION").as_bytes();
    let len = bytes.len().min(VERSION_BUFFER_CAP);
    // SAFETY: This runs once before fatal handlers are installed. Handlers read
    // only the prefix published by VERSION_LEN with Release/Acquire ordering.
    unsafe {
        let dst = &mut *VERSION_BYTES.0.get();
        dst[..len].copy_from_slice(&bytes[..len]);
    }
    VERSION_LEN.store(len, Ordering::Release);
}

fn crash_log_path_for_install() -> io::Result<PathBuf> {
    #[cfg(test)]
    if let Some(dir) = std::env::var_os(FATAL_TEST_CONFIG_DIR_ENV) {
        return Ok(PathBuf::from(dir).join("diagnostics").join("crash.log"));
    }

    let config_dir = crate::storage::paths::app_config_dir().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "cannot resolve app config directory")
    })?;
    Ok(config_dir.join("diagnostics").join("crash.log"))
}

fn open_crash_log_for_fatal_report() -> io::Result<std::fs::File> {
    let path = crash_log_path_for_install()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    rotate_crash_log_if_needed(&path, FATAL_REPORT_BUFFER_CAP as u64)?;
    OpenOptions::new().create(true).append(true).open(path)
}

fn rotate_crash_log_if_needed(path: &Path, incoming_len: u64) -> io::Result<()> {
    let current_size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if !should_rotate_crash_log(current_size, incoming_len, MAX_CRASH_LOG_BYTES) {
        return Ok(());
    }

    let backup_path = path.with_file_name(CRASH_LOG_BACKUP_FILE_NAME);
    let _ = fs::remove_file(&backup_path);
    if path.exists() {
        fs::rename(path, backup_path)?;
    }
    Ok(())
}

fn should_rotate_crash_log(current_size: u64, incoming_len: u64, max_bytes: u64) -> bool {
    current_size.saturating_add(incoming_len) > max_bytes
}

#[derive(Clone, Copy)]
enum FatalKind {
    #[cfg(any(unix, test))]
    Signal(i32),
    #[cfg(windows)]
    WindowsException(u32),
}

fn assemble_fatal_report(
    out: &mut [u8],
    kind: FatalKind,
    timestamp_ms: u64,
    version: &[u8],
    breadcrumbs: &[BreadcrumbRecord],
) -> usize {
    let mut pos = 0usize;
    let mut complete = true;

    complete &= append_bytes(out, &mut pos, b"\n=== voxis fatal crash ===\n");
    complete &= append_bytes(out, &mut pos, b"version: ");
    complete &= append_bytes(out, &mut pos, version);
    complete &= append_bytes(out, &mut pos, b"\n");
    complete &= append_kind(out, &mut pos, kind);
    complete &= append_bytes(out, &mut pos, b"timestamp_ms: ");
    complete &= append_u64(out, &mut pos, timestamp_ms);
    complete &= append_bytes(out, &mut pos, b"\n");
    complete &= append_bytes(out, &mut pos, b"breadcrumbs_count: ");
    complete &= append_u64(out, &mut pos, breadcrumbs.len() as u64);
    complete &= append_bytes(out, &mut pos, b"\n");

    for record in breadcrumbs {
        complete &= append_bytes(out, &mut pos, b"breadcrumb: monotonic_ms=");
        complete &= append_u64(out, &mut pos, record.monotonic_ms);
        complete &= append_bytes(out, &mut pos, b" name=");
        complete &= append_bytes(out, &mut pos, record.name.as_bytes());
        complete &= append_bytes(out, &mut pos, b"\n");
    }

    if !complete {
        append_truncation_marker(out, &mut pos);
    }

    pos
}

fn append_kind(out: &mut [u8], pos: &mut usize, kind: FatalKind) -> bool {
    match kind {
        #[cfg(any(unix, test))]
        FatalKind::Signal(signal) => {
            let mut complete = append_bytes(out, pos, b"signal: ");
            complete &= append_i32(out, pos, signal);
            complete &= append_bytes(out, pos, b" (");
            complete &= append_bytes(out, pos, signal_name(signal));
            complete &= append_bytes(out, pos, b")\n");
            complete
        }
        #[cfg(windows)]
        FatalKind::WindowsException(code) => {
            let mut complete = append_bytes(out, pos, b"exception_code: ");
            complete &= append_u64(out, pos, code as u64);
            complete &= append_bytes(out, pos, b" (0x");
            complete &= append_hex_u32(out, pos, code);
            complete &= append_bytes(out, pos, b")\n");
            complete
        }
    }
}

#[cfg(any(unix, test))]
fn signal_name(signal: i32) -> &'static [u8] {
    #[cfg(unix)]
    {
        match signal {
            libc::SIGSEGV => b"SIGSEGV",
            libc::SIGABRT => b"SIGABRT",
            libc::SIGBUS => b"SIGBUS",
            libc::SIGILL => b"SIGILL",
            _ => b"UNKNOWN",
        }
    }

    #[cfg(not(unix))]
    {
        match signal {
            11 => b"SIGSEGV",
            6 => b"SIGABRT",
            7 => b"SIGBUS",
            4 => b"SIGILL",
            _ => b"UNKNOWN",
        }
    }
}

fn append_truncation_marker(out: &mut [u8], pos: &mut usize) {
    const MARKER: &[u8] = b"\ntruncated: true\n";
    if out.is_empty() {
        return;
    }

    if out.len() >= MARKER.len() {
        let start = out.len() - MARKER.len();
        out[start..].copy_from_slice(MARKER);
        *pos = out.len();
    } else {
        let take = out.len();
        out[..take].copy_from_slice(&MARKER[..take]);
        *pos = out.len();
    }
}

fn append_i32(out: &mut [u8], pos: &mut usize, value: i32) -> bool {
    if value < 0 {
        let mut complete = append_bytes(out, pos, b"-");
        complete &= append_u64(out, pos, value.unsigned_abs() as u64);
        complete
    } else {
        append_u64(out, pos, value as u64)
    }
}

fn append_u64(out: &mut [u8], pos: &mut usize, mut value: u64) -> bool {
    let mut digits = [0u8; 20];
    let mut cursor = digits.len();

    if value == 0 {
        cursor -= 1;
        digits[cursor] = b'0';
    } else {
        while value > 0 {
            cursor -= 1;
            digits[cursor] = b'0' + (value % 10) as u8;
            value /= 10;
        }
    }

    append_bytes(out, pos, &digits[cursor..])
}

#[cfg(windows)]
fn append_hex_u32(out: &mut [u8], pos: &mut usize, value: u32) -> bool {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut digits = [0u8; 8];
    for (idx, slot) in digits.iter_mut().enumerate() {
        let shift = (7 - idx) * 4;
        *slot = HEX[((value >> shift) & 0x0f) as usize];
    }
    append_bytes(out, pos, &digits)
}

fn append_bytes(out: &mut [u8], pos: &mut usize, bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    if *pos >= out.len() {
        return false;
    }

    let available = out.len() - *pos;
    let take = available.min(bytes.len());
    out[*pos..*pos + take].copy_from_slice(&bytes[..take]);
    *pos += take;
    take == bytes.len()
}

fn version_bytes_for_handler() -> &'static [u8] {
    let len = VERSION_LEN.load(Ordering::Acquire).min(VERSION_BUFFER_CAP);
    // SAFETY: VERSION_BYTES is written once during install before VERSION_LEN is
    // published. The returned static slice is read-only in the handler.
    unsafe { std::slice::from_raw_parts((*VERSION_BYTES.0.get()).as_ptr(), len) }
}

fn report_buffer_for_handler() -> &'static mut [u8] {
    // SAFETY: HANDLING_FATAL is a process-wide reentrancy guard. The first
    // handler owns this static scratch buffer until it re-raises and exits.
    unsafe { &mut *REPORT_BUFFER.0.get() }
}

fn breadcrumb_buffer_for_handler() -> &'static mut [BreadcrumbRecord] {
    // SAFETY: HANDLING_FATAL is a process-wide reentrancy guard. The first
    // handler owns this static scratch buffer until it re-raises and exits.
    unsafe { &mut *BREADCRUMB_BUFFER.0.get() }
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::fd::IntoRawFd;
    use std::ptr;
    use std::sync::atomic::{AtomicI32, Ordering};

    const FATAL_SIGNALS: [i32; 4] = [libc::SIGSEGV, libc::SIGABRT, libc::SIGBUS, libc::SIGILL];
    const ALT_STACK_MIN_BYTES: usize = 64 * 1024;

    static CRASH_LOG_FD: AtomicI32 = AtomicI32::new(-1);

    pub(super) fn install() -> Result<(), InstallError> {
        let file = open_crash_log_for_fatal_report()
            .map_err(|err| InstallError::new(InstallStep::CrashLog, err))?;
        CRASH_LOG_FD.store(file.into_raw_fd(), Ordering::Release);

        let mut first_error = install_thread_altstack()
            .err()
            .map(|err| InstallError::new(InstallStep::MainThreadAltStack, err));

        if let Err(err) = install_sigactions() {
            if first_error.is_none() {
                first_error = Some(InstallError::new(InstallStep::Sigaction, err));
            }
        }

        match first_error {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }

    pub(super) fn install_thread_altstack() -> io::Result<()> {
        if current_thread_has_altstack()? {
            return Ok(());
        }

        let stack_size = libc::SIGSTKSZ.max(ALT_STACK_MIN_BYTES);
        let mut stack = vec![0u8; stack_size].into_boxed_slice();
        let stack_ptr = stack.as_mut_ptr();
        let stack_len = stack.len();
        let _leaked_stack: &'static mut [u8] = Box::leak(stack);

        let alt_stack = libc::stack_t {
            ss_sp: stack_ptr.cast(),
            ss_flags: 0,
            ss_size: stack_len,
        };

        // SAFETY: `alt_stack` points to leaked process-lifetime memory and the
        // old-stack pointer is null because this is an install operation.
        let rc = unsafe { libc::sigaltstack(&alt_stack, ptr::null_mut()) };
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    fn current_thread_has_altstack() -> io::Result<bool> {
        // SAFETY: A zeroed stack_t is acceptable as output storage before the
        // kernel fills it via the query-only sigaltstack call below.
        let mut old_stack: libc::stack_t = unsafe { std::mem::zeroed() };
        // SAFETY: Passing NULL as the new stack and a valid pointer for the old
        // stack is the POSIX query form of sigaltstack(2).
        let rc = unsafe { libc::sigaltstack(ptr::null(), &mut old_stack) };
        if rc != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok((old_stack.ss_flags & libc::SS_DISABLE) == 0 && old_stack.ss_size > 0)
    }

    fn install_sigactions() -> io::Result<()> {
        for signal in FATAL_SIGNALS {
            // SAFETY: A zeroed sigaction is immediately initialized below before
            // being passed to sigaction(2).
            let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
            action.sa_flags = libc::SA_SIGINFO | libc::SA_ONSTACK;
            action.sa_sigaction = handle_fatal_signal as *const () as usize;
            // SAFETY: `sa_mask` belongs to `action` and is valid to initialize.
            let rc = unsafe { libc::sigemptyset(&mut action.sa_mask) };
            if rc != 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: Installs our handler for fatal crash signals only. The
            // handler re-raises with SIG_DFL so OS core-dump behavior remains.
            let rc = unsafe { libc::sigaction(signal, &action, ptr::null_mut()) };
            if rc != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(())
    }

    extern "C" fn handle_fatal_signal(
        signal: i32,
        _info: *mut libc::siginfo_t,
        _context: *mut libc::c_void,
    ) {
        if HANDLING_FATAL.swap(true, Ordering::SeqCst) {
            reraise_with_default(signal);
        }

        let fd = CRASH_LOG_FD.load(Ordering::Acquire);
        if fd >= 0 {
            let timestamp_ms = monotonic_timestamp_ms();
            let breadcrumbs = breadcrumb_buffer_for_handler();
            let count = breadcrumbs::snapshot(breadcrumbs);
            let report = report_buffer_for_handler();
            let len = assemble_fatal_report(
                report,
                FatalKind::Signal(signal),
                timestamp_ms,
                version_bytes_for_handler(),
                &breadcrumbs[..count],
            );
            write_all_fd(fd, &report[..len]);
        }

        reraise_with_default(signal);
    }

    fn monotonic_timestamp_ms() -> u64 {
        // SAFETY: clock_gettime is async-signal-safe on POSIX systems. On error
        // we return 0 rather than touching formatting/logging in the handler.
        unsafe {
            let mut ts: libc::timespec = std::mem::zeroed();
            if libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) != 0 {
                return 0;
            }
            (ts.tv_sec as u64)
                .saturating_mul(1000)
                .saturating_add((ts.tv_nsec as u64) / 1_000_000)
        }
    }

    fn write_all_fd(fd: i32, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            // SAFETY: `bytes` is a valid read-only buffer and `fd` was opened at
            // install time. write(2) is async-signal-safe.
            let written = unsafe { libc::write(fd, bytes.as_ptr().cast(), bytes.len()) };
            if written <= 0 {
                break;
            }
            let written = written as usize;
            if written >= bytes.len() {
                break;
            }
            bytes = &bytes[written..];
        }
    }

    fn reraise_with_default(signal: i32) -> ! {
        // SAFETY: signal()/raise()/_exit() are async-signal-safe. Resetting the
        // disposition before raise prevents recursive handling and preserves the
        // OS-visible abnormal termination / core-dump behavior.
        unsafe {
            libc::signal(signal, libc::SIG_DFL);
            libc::raise(signal);
            libc::_exit(128 + signal);
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::io::IntoRawHandle;
    use std::ptr;
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows_sys::Win32::Storage::FileSystem::WriteFile;
    use windows_sys::Win32::System::Diagnostics::Debug::{
        SetUnhandledExceptionFilter, EXCEPTION_POINTERS,
    };
    use windows_sys::Win32::System::SystemInformation::GetTickCount64;

    static CRASH_LOG_HANDLE: AtomicIsize = AtomicIsize::new(0);

    pub(super) fn install() -> Result<(), InstallError> {
        let file = open_crash_log_for_fatal_report()
            .map_err(|err| InstallError::new(InstallStep::CrashLog, err))?;
        CRASH_LOG_HANDLE.store(file.into_raw_handle() as isize, Ordering::Release);
        // SAFETY: Registers a process-wide unhandled exception filter. Returning
        // CONTINUE_SEARCH (0) from the filter below keeps normal abnormal
        // termination semantics instead of swallowing the exception.
        unsafe {
            SetUnhandledExceptionFilter(Some(unhandled_exception_filter));
        }
        Ok(())
    }

    unsafe extern "system" fn unhandled_exception_filter(
        exception_info: *const EXCEPTION_POINTERS,
    ) -> i32 {
        if HANDLING_FATAL.swap(true, Ordering::SeqCst) {
            return 0;
        }

        let handle = CRASH_LOG_HANDLE.load(Ordering::Acquire);
        if handle != 0 {
            // SAFETY: The OS supplied `exception_info` for this callback. The
            // helper checks for null before dereferencing.
            let code = unsafe { exception_code(exception_info) };
            // SAFETY: GetTickCount64 is a leaf Win32 query and does not allocate.
            let timestamp_ms = unsafe { GetTickCount64() };
            let breadcrumbs = breadcrumb_buffer_for_handler();
            let count = breadcrumbs::snapshot(breadcrumbs);
            let report = report_buffer_for_handler();
            let len = assemble_fatal_report(
                report,
                FatalKind::WindowsException(code),
                timestamp_ms,
                version_bytes_for_handler(),
                &breadcrumbs[..count],
            );
            // SAFETY: `handle` was opened at install time and `report[..len]` is
            // a valid immutable byte buffer for the duration of the call.
            unsafe { write_all_handle(handle, &report[..len]) };
        }

        // EXCEPTION_CONTINUE_SEARCH. Do not claim the exception was handled.
        0
    }

    unsafe fn exception_code(exception_info: *const EXCEPTION_POINTERS) -> u32 {
        if exception_info.is_null() {
            return 0;
        }
        // SAFETY: `exception_info` was null-checked above and is supplied by the
        // OS for this callback. We only read the nested pointer value here.
        let record = unsafe { (*exception_info).ExceptionRecord };
        if record.is_null() {
            return 0;
        }
        // SAFETY: `record` was null-checked. ExceptionCode is i32 (NTSTATUS) in
        // windows-sys; cast the bit pattern to u32 rather than try_into().unwrap()
        // because real STATUS_* values are negative.
        unsafe { (*record).ExceptionCode as u32 }
    }

    unsafe fn write_all_handle(handle: isize, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            let chunk_len = bytes.len().min(u32::MAX as usize) as u32;
            let mut written = 0u32;
            // SAFETY: `bytes.as_ptr()` is a valid `*const u8` for `chunk_len`
            // bytes, `written` is valid output storage, and the handle was
            // opened during install.
            let ok = unsafe {
                WriteFile(
                    handle as _,
                    bytes.as_ptr(),
                    chunk_len,
                    &mut written,
                    ptr::null_mut(),
                )
            };
            if ok == 0 || written == 0 {
                break;
            }
            bytes = &bytes[written as usize..];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rendered(buf: &[u8], len: usize) -> &str {
        std::str::from_utf8(&buf[..len]).expect("fatal report is utf8")
    }

    #[test]
    fn fatal_append_u64_formats_zero_one_and_large_values() {
        let mut buf = [0u8; 64];
        let mut pos = 0;

        assert!(append_u64(&mut buf, &mut pos, 0));
        assert!(append_bytes(&mut buf, &mut pos, b" "));
        assert!(append_u64(&mut buf, &mut pos, 1));
        assert!(append_bytes(&mut buf, &mut pos, b" "));
        assert!(append_u64(&mut buf, &mut pos, u64::MAX));

        assert_eq!(rendered(&buf, pos), "0 1 18446744073709551615");
    }

    #[test]
    fn fatal_append_i32_formats_negative_values_without_formatting_macros() {
        let mut buf = [0u8; 16];
        let mut pos = 0;

        assert!(append_i32(&mut buf, &mut pos, -12345));

        assert_eq!(rendered(&buf, pos), "-12345");
    }

    #[test]
    fn fatal_append_bytes_reports_truncation_and_advances_to_capacity() {
        let mut buf = [0u8; 4];
        let mut pos = 0;

        assert!(!append_bytes(&mut buf, &mut pos, b"abcdef"));

        assert_eq!(pos, 4);
        assert_eq!(&buf, b"abcd");
    }

    #[test]
    fn fatal_report_contains_signal_name_version_timestamp_and_breadcrumbs() {
        let breadcrumbs = [
            BreadcrumbRecord {
                monotonic_ms: 12,
                name: "tauri:build:pre",
            },
            BreadcrumbRecord {
                monotonic_ms: 34,
                name: "transcription:queued",
            },
        ];
        let mut buf = [0u8; 1024];

        let len = assemble_fatal_report(
            &mut buf,
            FatalKind::Signal(libc::SIGABRT),
            9876,
            b"0.1.test",
            &breadcrumbs,
        );
        let report = rendered(&buf, len);

        assert!(report.contains("=== voxis fatal crash ==="));
        assert!(report.contains("version: 0.1.test"));
        assert!(report.contains("signal: 6 (SIGABRT)"));
        assert!(report.contains("timestamp_ms: 9876"));
        assert!(report.contains("breadcrumbs_count: 2"));
        assert!(report.contains("breadcrumb: monotonic_ms=12 name=tauri:build:pre"));
        assert!(report.contains("breadcrumb: monotonic_ms=34 name=transcription:queued"));
    }

    #[test]
    fn fatal_report_marks_truncation_when_buffer_is_too_small() {
        let breadcrumbs = [BreadcrumbRecord {
            monotonic_ms: 1,
            name: "very-long-breadcrumb-name-that-will-not-fit",
        }];
        let mut buf = [0u8; 48];

        let len = assemble_fatal_report(&mut buf, FatalKind::Signal(libc::SIGSEGV), 1, b"v", &breadcrumbs);
        let report = rendered(&buf, len);

        assert_eq!(len, buf.len());
        assert!(report.ends_with("\ntruncated: true\n"));
    }

    #[test]
    fn fatal_install_failure_is_recorded_for_later_observation() {
        clear_install_error();
        let first = io::Error::from_raw_os_error(13);
        let second = io::Error::from_raw_os_error(22);

        record_install_error(InstallStep::CrashLog, &first);
        record_install_error(InstallStep::Sigaction, &second);

        assert_eq!(
            last_install_error(),
            Some(InstallErrorSnapshot {
                step: InstallStep::CrashLog,
                os_error: 13,
            })
        );
        clear_install_error();
    }

    #[test]
    fn fatal_crash_log_rotation_decision_matches_clipshot_cap() {
        assert!(!should_rotate_crash_log(
            MAX_CRASH_LOG_BYTES - FATAL_REPORT_BUFFER_CAP as u64,
            FATAL_REPORT_BUFFER_CAP as u64,
            MAX_CRASH_LOG_BYTES,
        ));
        assert!(should_rotate_crash_log(
            MAX_CRASH_LOG_BYTES - FATAL_REPORT_BUFFER_CAP as u64 + 1,
            FATAL_REPORT_BUFFER_CAP as u64,
            MAX_CRASH_LOG_BYTES,
        ));
        assert!(should_rotate_crash_log(u64::MAX, 1, MAX_CRASH_LOG_BYTES));
    }

    #[test]
    fn fatal_crash_log_rotation_renames_existing_large_log() {
        let temp_dir = tempfile::tempdir().expect("temp crash dir");
        let path = temp_dir.path().join("crash.log");
        let backup = temp_dir.path().join(CRASH_LOG_BACKUP_FILE_NAME);

        std::fs::write(&path, vec![b'x'; MAX_CRASH_LOG_BYTES as usize])
            .expect("seed large crash log");
        rotate_crash_log_if_needed(&path, FATAL_REPORT_BUFFER_CAP as u64)
            .expect("rotate large crash log");

        assert!(!path.exists(), "current log should be rotated before append-open");
        assert!(backup.exists(), "backup log should exist after rotation");
        assert_eq!(
            std::fs::metadata(&backup).expect("backup metadata").len(),
            MAX_CRASH_LOG_BYTES,
        );
    }

    #[cfg(unix)]
    #[test]
    fn fatal_spawned_thread_altstack_is_installed_on_that_thread() {
        let handle = std::thread::spawn(|| {
            install_thread_altstack().expect("install spawned-thread altstack");
            // SAFETY: A zeroed stack_t is acceptable as output storage for the
            // query-only sigaltstack call below.
            let mut old_stack: libc::stack_t = unsafe { std::mem::zeroed() };
            // SAFETY: Query-only sigaltstack call with a valid output pointer.
            let rc = unsafe { libc::sigaltstack(std::ptr::null(), &mut old_stack) };
            assert_eq!(rc, 0, "sigaltstack query failed");
            assert_ne!(old_stack.ss_flags & libc::SS_DISABLE, libc::SS_DISABLE);
            assert!(old_stack.ss_size > 0);
        });

        handle.join().expect("altstack test thread should not panic");
    }

    #[cfg(unix)]
    #[test]
    fn fatal_unix_e2e_sigabrt_writes_report_env_gated() {
        if std::env::var_os(FATAL_E2E_ENV).is_none() {
            return;
        }

        if std::env::var_os(FATAL_E2E_CHILD_ENV).is_some() {
            breadcrumbs::init();
            breadcrumbs::sticky("fatal-test:before-sigabrt");
            install();
            // SAFETY: Test-only child process deliberately raises SIGABRT after
            // installing the handler; the parent asserts the abnormal exit.
            unsafe {
                libc::raise(libc::SIGABRT);
            }
            unreachable!("SIGABRT should terminate the child after re-raise");
        }

        let temp_dir = tempfile::tempdir().expect("temp crash dir");
        let test_exe = std::env::current_exe().expect("current test executable");
        let test_name = "diagnostics::fatal::tests::fatal_unix_e2e_sigabrt_writes_report_env_gated";
        let status = std::process::Command::new(test_exe)
            .arg("--exact")
            .arg(test_name)
            .arg("--nocapture")
            .env(FATAL_E2E_ENV, "1")
            .env(FATAL_E2E_CHILD_ENV, "1")
            .env(FATAL_TEST_CONFIG_DIR_ENV, temp_dir.path())
            .status()
            .expect("spawn fatal e2e child");

        assert!(!status.success(), "child should terminate by SIGABRT");
        let report_path = temp_dir.path().join("diagnostics").join("crash.log");
        let report = std::fs::read_to_string(&report_path).expect("fatal crash report written");
        assert!(report.contains("signal: 6 (SIGABRT)"), "report was: {report}");
        assert!(report.contains("version: "), "report was: {report}");
        assert!(
            report.contains("breadcrumb: monotonic_ms=")
                && report.contains("name=fatal-test:before-sigabrt"),
            "report was: {report}"
        );
    }
}
