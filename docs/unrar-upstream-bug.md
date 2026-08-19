# Upstream bug report (ready to file): unrar 0.5.8

Not filed — this is a draft for a maintainer to send to
<https://github.com/muja/unrar.rs/issues>. Kept in the repo so the
analysis isn't lost and nobody has to re-derive it.

---

**Title:** `UCM_CHANGEVOLUMEW` handler reads 8 KB past the volume-name
buffer (UB on every multi-volume archive)

**Version:** unrar 0.5.8 (latest), unrar_sys 0.5.8

**Summary**

`Internal::callback` handles `UCM_CHANGEVOLUMEW` with:

```rust
let next = unsafe {
    widestring::WideCString::from_ptr_truncate(p1 as *const _, 2048)
};
```

`from_ptr_truncate(p, len)` builds `slice::from_raw_parts(p, 2048)` and
passes it to `from_vec_truncate`, whose `impl Into<Vec<u32>>` **copies all
2048 elements before** truncating at the NUL. So every volume change
copies 2048 × 4 = 8192 bytes out of the pointer UnRAR supplied.

That pointer is `NextName.data()` from `DllVolNotify` (`volume.cpp:274`),
where `NextName` is a `std::wstring` holding a path. For a typical
~60-character path that is a ~7.7 KB out-of-bounds heap read on every
volume transition.

**Reproducer**

Any multi-volume archive, in a build with debug assertions:

```rust
for entry in Archive::new(path).open_for_listing()? { let _ = entry?; }
```

```text
unsafe precondition(s) violated: ptr::copy_nonoverlapping requires that
both pointer arguments are aligned and non-null and the specified memory
ranges do not overlap
  core::ptr::copy_nonoverlapping::precondition_check
  <u32 as <[_]>::to_vec_in::ConvertVec>::to_vec
  widestring::ucstring::U32CString::from_vec_truncate
  widestring::ucstring::U32CString::from_ptr_truncate
  unrar::open_archive::Internal<Skip>::callback   (open_archive.rs:519)
  DllVolNotify                                    (volume.cpp:274)
  MergeArchive                                    (volume.cpp:134)
  ProcessFile                                     (dll.cpp:337)
```

Observed on a 9-volume, 127 GB archive (aarch64-apple-darwin, Rust
stable). Single-volume archives never reach the callback, which is
probably why it has gone unnoticed.

**Impact**

Release builds compile the precondition check out and behave correctly —
the value is right, because the copy is still truncated at the true NUL.
The unsoundness is the over-read itself: it can fault if the allocation
sits near an unmapped page, and it pulls adjacent heap bytes into the
string before discarding them. Debug builds abort outright, so any
downstream test suite that touches a multi-part archive cannot run.

**Suggested fix**

Bound the read by the actual string length instead of a fixed 2048.
UnRAR NUL-terminates `NextName`, so scanning first and then copying only
what is there is enough — e.g. find the NUL within a 2048 cap and build
the `WideCString` from that prefix, rather than materialising 2048
elements up front.
