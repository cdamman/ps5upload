//! How much room is left on the host disk, and whether a staged extraction
//! will fit in it.
//!
//! A `.rar` upload extracts to a staging directory on the PC before sending.
//! A user uploading a 180 GB game into `C:\Users\...\Downloads` filled their
//! disk, and the only sign was `extract rar entry: Write error` five minutes
//! in — after tens of GB had already been written, and with the half-written
//! staging directory left behind.
//!
//! We know the uncompressed total from the archive's headers before extracting
//! a single byte, so that failure is entirely avoidable: compare it against
//! the free space and refuse up front, with a message that says what to do.

use std::path::Path;

/// Bytes available on the filesystem holding `path`.
///
/// `None` means we could not tell — an unmounted path, a platform we have no
/// implementation for, or a failing syscall. Callers must treat `None` as
/// "proceed", never as "no space": refusing an upload because a stat failed
/// would be worse than the problem being solved.
#[cfg(unix)]
pub fn available_bytes(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `c` is a valid NUL-terminated C string that outlives the call,
    // and `st` is fully initialised by statvfs on success.
    unsafe {
        let mut st: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c.as_ptr(), &mut st) != 0 {
            return None;
        }
        // f_bavail is what an unprivileged process may actually use, which is
        // smaller than f_bfree on filesystems that reserve blocks for root.
        // Using f_bfree here would promise space we cannot write to.
        let frag = if st.f_frsize > 0 {
            st.f_frsize as u64
        } else {
            st.f_bsize as u64
        };
        Some((st.f_bavail as u64).saturating_mul(frag))
    }
}

#[cfg(windows)]
pub fn available_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;

    // Declared directly rather than pulling in `windows`/`winapi`: this is one
    // call, and the dependency tree here is kept deliberately small so the
    // Android cross-compile stays clean.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    let mut free_to_caller: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;
    // SAFETY: `wide` is NUL-terminated and outlives the call; the three out
    // params are valid, writable u64s.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_to_caller,
            &mut total,
            &mut total_free,
        )
    };
    if ok == 0 {
        return None;
    }
    // "Available to caller" honours per-user quotas, which is what we can
    // actually write.
    Some(free_to_caller)
}

#[cfg(not(any(unix, windows)))]
pub fn available_bytes(_path: &Path) -> Option<u64> {
    None
}

/// Leave this much room rather than filling the disk to the last byte.
///
/// Writing a volume to exactly zero free tends to break unrelated things —
/// the OS, the browser, whatever else is running — so the check reserves a
/// slice for everyone else.
pub const STAGING_MARGIN_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Peak bytes an extraction will hold on the host at once.
///
/// Unbatched (`budget == 0`) stages the whole archive. Batched stages at most
/// one batch — and never more than the archive itself, so a small archive
/// isn't reported as needing a large budget's worth of room.
///
/// `largest_file` is the floor, and it matters: a single file cannot be split
/// across batches, so one bigger than the budget is extracted whole and the
/// disk has to hold all of it. PS5 dumps regularly carry single files far
/// larger than any sensible budget (a 50 GB `.exfat` image, say), and
/// reporting just the budget there would wave through an upload that then
/// fills the disk mid-extraction — the very failure this check exists to
/// prevent.
pub fn staging_requirement(total_uncompressed: u64, largest_file: u64, budget: u64) -> u64 {
    if budget == 0 {
        total_uncompressed
    } else {
        budget.min(total_uncompressed).max(largest_file)
    }
}

/// Bytes short, or `None` when there is enough room (or we cannot tell).
pub fn staging_shortfall(required: u64, available: Option<u64>, margin: u64) -> Option<u64> {
    let available = available?;
    let need = required.saturating_add(margin);
    if available >= need {
        None
    } else {
        Some(need - available)
    }
}

/// Bytes as a short human string, for messages users read.
pub fn human_bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    if u == 0 {
        format!("{n} B")
    } else if v >= 100.0 {
        format!("{v:.0} {}", UNITS[u])
    } else {
        format!("{v:.1} {}", UNITS[u])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn unbatched_needs_the_whole_archive() {
        assert_eq!(staging_requirement(180 * GB, 9 * GB, 0), 180 * GB);
    }

    #[test]
    fn batched_needs_only_one_batch() {
        assert_eq!(staging_requirement(180 * GB, 2 * GB, 4 * GB), 4 * GB);
    }

    #[test]
    fn a_budget_larger_than_the_archive_needs_only_the_archive() {
        assert_eq!(staging_requirement(2 * GB, 1 * GB, 64 * GB), 2 * GB);
    }

    #[test]
    fn a_single_file_larger_than_the_budget_sets_the_floor() {
        // A file cannot be split across batches, so it is extracted whole and
        // the disk must hold all of it. Reporting only the budget here would
        // wave through an upload that then fills the disk part-way — the
        // exact failure the pre-flight check exists to prevent. PS5 dumps
        // routinely contain single files far bigger than a sane budget.
        assert_eq!(staging_requirement(180 * GB, 20 * GB, 4 * GB), 20 * GB);
    }

    #[test]
    fn the_largest_file_does_not_inflate_an_unbatched_requirement() {
        // Unbatched already stages everything; the largest file is a subset.
        assert_eq!(staging_requirement(180 * GB, 20 * GB, 0), 180 * GB);
    }

    #[test]
    fn a_largest_file_under_the_budget_changes_nothing() {
        assert_eq!(staging_requirement(180 * GB, 1 * GB, 4 * GB), 4 * GB);
    }

    #[test]
    fn enough_room_reports_no_shortfall() {
        assert_eq!(staging_shortfall(10 * GB, Some(50 * GB), 2 * GB), None);
    }

    #[test]
    fn reports_how_much_is_missing() {
        // Needs 10 + 2 margin = 12; has 5 → short by 7.
        assert_eq!(
            staging_shortfall(10 * GB, Some(5 * GB), 2 * GB),
            Some(7 * GB)
        );
    }

    #[test]
    fn the_margin_counts_toward_the_requirement() {
        // Exactly enough for the files but nothing spare: still short.
        assert_eq!(
            staging_shortfall(10 * GB, Some(10 * GB), 2 * GB),
            Some(2 * GB)
        );
    }

    #[test]
    fn exactly_meeting_the_requirement_plus_margin_passes() {
        assert_eq!(staging_shortfall(10 * GB, Some(12 * GB), 2 * GB), None);
    }

    #[test]
    fn unknown_free_space_never_blocks_an_upload() {
        // A failed stat must not refuse a transfer that would have worked.
        assert_eq!(staging_shortfall(u64::MAX, None, 2 * GB), None);
    }

    #[test]
    fn a_huge_requirement_does_not_overflow_into_success() {
        // required + margin must saturate, not wrap to a small number and
        // report "fits".
        assert_eq!(
            staging_shortfall(u64::MAX, Some(1024), 2 * GB),
            Some(u64::MAX - 1024)
        );
    }

    #[test]
    fn the_real_lookup_answers_for_the_current_directory() {
        // Whatever the platform, the directory the tests run in exists and is
        // mounted, so this must not be None — otherwise the guard silently
        // never fires.
        let got = available_bytes(Path::new("."));
        assert!(got.is_some(), "available_bytes returned None for '.'");
        assert!(got.unwrap() > 0, "reported zero free bytes for '.'");
    }

    #[test]
    fn a_nonexistent_path_is_unknown_rather_than_zero() {
        // Must be None ("can't tell", proceed) and never Some(0), which would
        // refuse every upload.
        let got = available_bytes(Path::new("/definitely/not/a/real/mount/xyzzy"));
        assert_ne!(got, Some(0));
    }

    #[test]
    fn human_bytes_reads_the_way_people_expect() {
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(2 * GB), "2.0 GB");
        assert_eq!(human_bytes(180 * GB), "180 GB");
    }
}
