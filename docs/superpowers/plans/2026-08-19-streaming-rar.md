# Streaming `.rar` Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `.rar` file bytes to the PS5 as they are decompressed, so a `.rar` upload needs no host staging directory and no free disk space at all.

**Architecture:** UnRAR pushes decompressed chunks through a C callback; `PipelinedSender` pulls. A worker thread runs the UnRAR loop and pushes chunks into a bounded channel; the main thread wraps the receiver in a `Read` and drives a send loop that is a near-copy of the proven `.7z` loop — same sender, same resume rule, same desync check. The staged/batched path is then deleted.

**Tech Stack:** Rust, `std::sync::mpsc::sync_channel`, vendored `unrar` 0.5.8 (`third_party/unrar`), existing FTX2 `PipelinedSender`, mock FTX2 server for integration tests.

**Spec:** `docs/superpowers/specs/2026-08-19-streaming-rar-design.md`

## Global Constraints

- Work in `engine/` unless a path says otherwise. Gate command: `npm run validate` from the repo root; formatting via `cd engine && cargo fmt --all -- --check`.
- **Never run `cargo fmt --all` to fix formatting** — local rustfmt disagrees with CI's on files you did not touch. Fix only your own hunks by hand.
- The vendored crate carries local changes. Every edit there gets a `ps5upload local` marker comment and a matching note in `third_party/unrar/README.md`.
- `.rar` is desktop-only: all new code lives under the existing `#[cfg(not(target_os = "android"))] mod rar_support`.
- Shard sequence numbers start at 1. `total_shards = next_seq - 1`.
- A zero-byte file still occupies exactly one shard.
- Resume rule, copied verbatim from the 7z loop: decode everything, but only send a shard when `seq > last_acked_shard`.
- Existing behaviour that must not regress: `rar_password_required`, `rar_password_wrong`, `rar_missing_volume: <file>`, and `.rar` metadata (`title`, `title_id`, `content_id`, `game_root`).

---

## File Structure

| File | Responsibility |
|---|---|
| `third_party/unrar/src/open_archive.rs` | Add `StreamSink` + `ReadToSink` process-mode and a seeded `process_file_raw`. |
| `third_party/unrar/README.md` | Record the second local change. |
| `engine/crates/ps5upload-core/src/rar_stream.rs` | **New.** `StreamMsg`, the worker thread, and `EntryReader`. Isolated so the bridge is unit-testable without an archive. |
| `engine/crates/ps5upload-core/src/transfer.rs` | Streaming send loop; deletion of the staged path. |
| `engine/crates/ps5upload-core/src/host_space.rs` | **Deleted** in Task 5. |
| `engine/crates/ps5upload-tests/tests/transfer_rar_integration.rs` | Equivalence, resume, and cancellation tests. |

---

### Task 1: Sink process-mode in the vendored crate

**Files:**
- Modify: `third_party/unrar/src/open_archive.rs`
- Modify: `third_party/unrar/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub struct StreamSink`, `StreamSink::new(tx: std::sync::mpsc::SyncSender<Box<[u8]>>) -> StreamSink`, `StreamSink::disconnected(&self) -> bool`, and `OpenArchive<Process, CursorBeforeFile>::read_to_sink(self, sink: StreamSink) -> UnrarResult<(StreamSink, OpenArchive<Process, CursorBeforeHeader>)>`.

- [ ] **Step 1: Write the failing test**

Append to `third_party/unrar/src/open_archive.rs`:

```rust
#[cfg(test)]
mod sink_tests {
    use super::*;

    #[test]
    fn sink_forwards_chunks_and_flags_disconnect() {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Box<[u8]>>(4);
        let mut sink = StreamSink::new(tx);
        ReadToSink::process_data(&mut sink, b"hello ");
        ReadToSink::process_data(&mut sink, b"world");
        assert!(!sink.disconnected());
        let got: Vec<u8> = rx.try_iter().flat_map(|c| c.into_vec()).collect();
        assert_eq!(got, b"hello world");

        // Consumer gone: must flag, never panic — this runs inside a C callback.
        drop(rx);
        ReadToSink::process_data(&mut sink, b"more");
        assert!(sink.disconnected());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && cargo test -p unrar sink_tests 2>&1 | tail -5`
Expected: FAIL — `cannot find type StreamSink`.

- [ ] **Step 3: Write minimal implementation**

Add near the other `ProcessMode` impls:

```rust
/// ps5upload local addition: stream decompressed bytes to a channel instead
/// of accumulating them in a `Vec`.
///
/// Upstream offers `ReadToVec`, which buffers a whole entry in memory. PS5
/// game dumps carry single entries of 30 GB and more, so ps5upload needs the
/// chunks as they arrive. `Operation::Test` is what makes this possible: it
/// decompresses through the callback WITHOUT writing files to disk.
pub struct StreamSink {
    tx: Option<std::sync::mpsc::SyncSender<Box<[u8]>>>,
    disconnected: bool,
}

impl std::fmt::Debug for StreamSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamSink")
            .field("disconnected", &self.disconnected)
            .finish()
    }
}

impl Default for StreamSink {
    fn default() -> Self {
        Self { tx: None, disconnected: false }
    }
}

impl StreamSink {
    pub fn new(tx: std::sync::mpsc::SyncSender<Box<[u8]>>) -> Self {
        Self { tx: Some(tx), disconnected: false }
    }

    /// True once the receiving end went away. The caller stops the walk; we
    /// cannot return an error from inside the C callback.
    pub fn disconnected(&self) -> bool {
        self.disconnected
    }
}

struct ReadToSink;

impl ProcessMode for ReadToSink {
    const OPERATION: private::Operation = private::Operation::Test;
    type Output = StreamSink;

    fn process_data(sink: &mut Self::Output, data: &[u8]) {
        if sink.disconnected {
            return;
        }
        let Some(tx) = sink.tx.as_ref() else {
            sink.disconnected = true;
            return;
        };
        // Blocks while the consumer is busy — this IS the backpressure.
        if tx.send(data.to_vec().into_boxed_slice()).is_err() {
            sink.disconnected = true;
        }
    }
}
```

Add the seeded raw call next to `process_file_raw`:

```rust
    /// ps5upload local addition: like `process_file_raw`, but starts from a
    /// caller-supplied `Output` instead of `Default::default()`. `StreamSink`
    /// has to carry a channel in, which `Default` cannot express.
    fn process_file_raw_seeded(
        handle: &Handle,
        path: Option<&pathed::RarStr>,
        file: Option<&pathed::RarStr>,
        seed: M::Output,
    ) -> UnrarResult<M::Output> {
        // `Userdata<T>` is a type alias for `(T, Option<WideCString>)`.
        let mut user_data: Userdata<M::Output> = (seed, None);
        unsafe {
            native::RARSetCallback(
                handle.0.as_ptr(),
                Some(Self::callback),
                &mut user_data as *mut _ as native::LPARAM,
            );
        }
        let process_result = Code::from(pathed::process_file(
            handle.0.as_ptr(),
            M::OPERATION as i32,
            path,
            file,
        ))
        .unwrap();
        match process_result {
            Code::Success => Ok(user_data.0),
            _ => Err(UnrarError::from(process_result, When::Process)),
        }
    }
```

And the public entry point, beside `read`:

```rust
    /// ps5upload local addition: decompress this entry straight into `sink`.
    /// Returns the sink (so the caller can check `disconnected`) and the
    /// archive positioned at the next header.
    pub fn read_to_sink(
        self,
        sink: StreamSink,
    ) -> UnrarResult<(StreamSink, OpenArchive<Process, CursorBeforeHeader>)> {
        let out = Internal::<ReadToSink>::process_file_raw_seeded(
            &self.handle,
            None,
            None,
            sink,
        )?;
        Ok((
            out,
            OpenArchive {
                extra: CursorBeforeHeader,
                damaged: self.damaged,
                handle: self.handle,
                flags: self.flags,
                marker: std::marker::PhantomData,
            },
        ))
    }
```

`Userdata<T>` is defined at `open_archive.rs:54` as the type alias `(T, Option<widestring::WideCString>)` — construct it as a plain tuple, not a struct.

- [ ] **Step 4: Re-export `StreamSink` from the crate root**

`third_party/unrar/src/lib.rs` re-exports selected types; `StreamSink` must
join them or `unrar::StreamSink` will not resolve in Task 3:

```rust
pub use open_archive::{
    CursorBeforeFile, CursorBeforeHeader, FileHeader, List, ListSplit, OpenArchive, Process,
    StreamSink, VolumeInfo,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd engine && cargo test -p unrar sink_tests 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 6: Record the local change**

Append to `third_party/unrar/README.md` under "The change", a second bullet naming `StreamSink` / `ReadToSink` / `process_file_raw_seeded` / `read_to_sink` and why (`ReadToVec` buffers whole entries; PS5 dumps have 30 GB+ files).

- [ ] **Step 7: Commit**

```bash
git add third_party/unrar
git commit -m "feat(unrar): add a streaming sink process-mode

Upstream only offers ReadToVec, which buffers an entire entry in memory.
PS5 dumps carry single entries far larger than RAM, so ps5upload needs the
chunks as UnRAR produces them. Operation::Test decompresses through the
callback without writing files, which is exactly the primitive required."
```

---

### Task 2: The push→pull bridge

**Files:**
- Create: `engine/crates/ps5upload-core/src/rar_stream.rs`
- Modify: `engine/crates/ps5upload-core/src/lib.rs` (add `pub mod rar_stream;` in alphabetical position)

**Interfaces:**
- Consumes: nothing from Task 1 at compile time (the worker lands in Task 3); this task is the message type and the reader.
- Produces:
  - `pub enum StreamMsg { Entry(String), Chunk(Box<[u8]>), EntryEnd, Finished, Failed(String) }`
  - `pub struct EntryReader<'a> { .. }` with `EntryReader::new(rx: &'a std::sync::mpsc::Receiver<StreamMsg>) -> Self`, implementing `std::io::Read`
  - `pub fn next_entry(rx: &std::sync::mpsc::Receiver<StreamMsg>) -> std::io::Result<Option<String>>`

- [ ] **Step 1: Write the failing tests**

Create `engine/crates/ps5upload-core/src/rar_stream.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::sync::mpsc::sync_channel;

    fn feed(msgs: Vec<StreamMsg>) -> std::sync::mpsc::Receiver<StreamMsg> {
        let (tx, rx) = sync_channel(64);
        for m in msgs {
            tx.send(m).unwrap();
        }
        drop(tx);
        rx
    }

    #[test]
    fn reassembles_chunks_into_one_stream() {
        let rx = feed(vec![
            StreamMsg::Entry("a.bin".into()),
            StreamMsg::Chunk(b"hello ".to_vec().into_boxed_slice()),
            StreamMsg::Chunk(b"world".to_vec().into_boxed_slice()),
            StreamMsg::EntryEnd,
        ]);
        assert_eq!(next_entry(&rx).unwrap().as_deref(), Some("a.bin"));
        let mut out = Vec::new();
        EntryReader::new(&rx).read_to_end(&mut out).unwrap();
        assert_eq!(out, b"hello world");
    }

    #[test]
    fn entry_end_is_eof_not_the_next_entry() {
        // The reader must stop at EntryEnd, or one file's bytes bleed into
        // the next file's shards.
        let rx = feed(vec![
            StreamMsg::Entry("a".into()),
            StreamMsg::Chunk(b"AAA".to_vec().into_boxed_slice()),
            StreamMsg::EntryEnd,
            StreamMsg::Entry("b".into()),
            StreamMsg::Chunk(b"BBB".to_vec().into_boxed_slice()),
            StreamMsg::EntryEnd,
        ]);
        assert_eq!(next_entry(&rx).unwrap().as_deref(), Some("a"));
        let mut a = Vec::new();
        EntryReader::new(&rx).read_to_end(&mut a).unwrap();
        assert_eq!(a, b"AAA");
        assert_eq!(next_entry(&rx).unwrap().as_deref(), Some("b"));
        let mut b = Vec::new();
        EntryReader::new(&rx).read_to_end(&mut b).unwrap();
        assert_eq!(b, b"BBB");
    }

    #[test]
    fn a_short_read_buffer_keeps_the_leftover() {
        let rx = feed(vec![
            StreamMsg::Entry("a".into()),
            StreamMsg::Chunk(b"abcdef".to_vec().into_boxed_slice()),
            StreamMsg::EntryEnd,
        ]);
        next_entry(&rx).unwrap();
        let mut r = EntryReader::new(&rx);
        let mut two = [0u8; 2];
        r.read_exact(&mut two).unwrap();
        assert_eq!(&two, b"ab");
        let mut rest = Vec::new();
        r.read_to_end(&mut rest).unwrap();
        assert_eq!(rest, b"cdef");
    }

    #[test]
    fn zero_byte_entry_reads_as_empty() {
        let rx = feed(vec![StreamMsg::Entry("z".into()), StreamMsg::EntryEnd]);
        next_entry(&rx).unwrap();
        let mut out = Vec::new();
        EntryReader::new(&rx).read_to_end(&mut out).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn finished_reports_no_more_entries() {
        let rx = feed(vec![StreamMsg::Finished]);
        assert!(next_entry(&rx).unwrap().is_none());
    }

    #[test]
    fn worker_failure_surfaces_as_an_error_not_eof() {
        // Silently treating a decode failure as end-of-file would commit a
        // truncated game to the console.
        let rx = feed(vec![
            StreamMsg::Entry("a".into()),
            StreamMsg::Failed("corrupt block".into()),
        ]);
        next_entry(&rx).unwrap();
        let mut out = Vec::new();
        let err = EntryReader::new(&rx).read_to_end(&mut out).unwrap_err();
        assert!(err.to_string().contains("corrupt block"), "got {err}");
    }

    #[test]
    fn a_dead_worker_is_an_error_not_eof() {
        let (tx, rx) = sync_channel::<StreamMsg>(1);
        tx.send(StreamMsg::Entry("a".into())).unwrap();
        drop(tx); // worker vanished mid-entry
        next_entry(&rx).unwrap();
        let mut out = Vec::new();
        assert!(EntryReader::new(&rx).read_to_end(&mut out).is_err());
    }

    #[test]
    fn failed_before_any_entry_surfaces_from_next_entry() {
        let rx = feed(vec![StreamMsg::Failed("bad password".into())]);
        let err = next_entry(&rx).unwrap_err();
        assert!(err.to_string().contains("bad password"), "got {err}");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p ps5upload-core rar_stream 2>&1 | tail -5`
Expected: FAIL — `cannot find type StreamMsg`.

- [ ] **Step 3: Write minimal implementation**

Prepend to the same file:

```rust
//! Bridge between UnRAR's push-style callback and the pull-style shard sender.
//!
//! UnRAR hands us decompressed bytes through a callback; `PipelinedSender`
//! wants something it can `read()`. A worker thread runs the UnRAR walk and
//! pushes entry-delimited messages down a bounded channel; this module turns
//! those back into one `Read` per entry.
//!
//! The framing matters: without `EntryEnd` the next file's bytes would flow
//! into the current file's shards and silently corrupt the upload.

use std::io::{Error, ErrorKind, Read};
use std::sync::mpsc::Receiver;

/// One message from the decompression worker.
#[derive(Debug)]
pub enum StreamMsg {
    /// A new entry begins; carries the sanitised relative path.
    Entry(String),
    /// Decompressed bytes for the entry in progress.
    Chunk(Box<[u8]>),
    /// The entry in progress is complete.
    EntryEnd,
    /// Every entry has been walked.
    Finished,
    /// The worker gave up; the string is the reason.
    Failed(String),
}

/// Await the next entry. `Ok(None)` means the archive is done.
pub fn next_entry(rx: &Receiver<StreamMsg>) -> std::io::Result<Option<String>> {
    match rx.recv() {
        Ok(StreamMsg::Entry(name)) => Ok(Some(name)),
        Ok(StreamMsg::Finished) => Ok(None),
        Ok(StreamMsg::Failed(msg)) => Err(Error::other(msg)),
        // Bytes with no entry open means the worker's framing is broken.
        Ok(other) => Err(Error::other(format!(
            "rar stream out of order: expected an entry, got {other:?}"
        ))),
        Err(_) => Err(Error::new(
            ErrorKind::UnexpectedEof,
            "rar decompression worker stopped unexpectedly",
        )),
    }
}

/// A `Read` over exactly one entry's bytes. EOF at `EntryEnd`.
pub struct EntryReader<'a> {
    rx: &'a Receiver<StreamMsg>,
    leftover: Vec<u8>,
    pos: usize,
    done: bool,
}

impl<'a> EntryReader<'a> {
    pub fn new(rx: &'a Receiver<StreamMsg>) -> Self {
        Self { rx, leftover: Vec::new(), pos: 0, done: false }
    }
}

impl Read for EntryReader<'_> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        while self.pos >= self.leftover.len() {
            if self.done {
                return Ok(0);
            }
            match self.rx.recv() {
                Ok(StreamMsg::Chunk(c)) => {
                    self.leftover = c.into_vec();
                    self.pos = 0;
                }
                Ok(StreamMsg::EntryEnd) => {
                    self.done = true;
                    return Ok(0);
                }
                Ok(StreamMsg::Failed(msg)) => return Err(Error::other(msg)),
                Ok(other) => {
                    return Err(Error::other(format!(
                        "rar stream out of order mid-entry: {other:?}"
                    )))
                }
                Err(_) => {
                    return Err(Error::new(
                        ErrorKind::UnexpectedEof,
                        "rar decompression worker stopped mid-entry",
                    ))
                }
            }
        }
        let n = std::cmp::min(out.len(), self.leftover.len() - self.pos);
        out[..n].copy_from_slice(&self.leftover[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}
```

Register it in `lib.rs`: add `pub mod rar_stream;` between `pub mod profile;` and the next module, keeping alphabetical order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && cargo test -p ps5upload-core rar_stream 2>&1 | tail -5`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/ps5upload-core/src/rar_stream.rs engine/crates/ps5upload-core/src/lib.rs
git commit -m "feat(rar): entry-framed bridge from UnRAR's callback to a Read

Kept in its own module so the framing is testable without an archive: a
missing EntryEnd would let one file's bytes flow into the next file's
shards, which no archive-level test would catch cleanly."
```

---

### Task 3: Streaming transfer, alongside the staged path

**Files:**
- Modify: `engine/crates/ps5upload-core/src/transfer.rs` (inside `mod rar_support`)

**Interfaces:**
- Consumes: `StreamSink`/`read_to_sink` (Task 1); `StreamMsg`/`EntryReader`/`next_entry` (Task 2); existing `rar_plan_preview`, `sanitize_rar_entry`, `map_rar_open_err`, `map_rar_err`, `PipelinedSender`, `Manifest`, `ManifestFile`, `join_ps5_path`, `ensure_manifest_paths_fit`, `send_begin_and_expect_ack`, `tx_meta_buf_flags`, `parse_last_acked_shard`, `guard_last_acked`, `send_commit_and_expect_ack`, `tx_meta_buf`, `Connection`, `TX_FLAG_APPLY_PROGRESS_REQUESTED`, `TX_FLAG_RESUME`.
- Produces: `fn transfer_rar_streaming(cfg: &TransferConfig, tx_id: [u8; 16], dest_root: &str, archive_path: &Path, password: Option<&str>, flags: u32) -> Result<TransferResult>`.

**Do not** change `transfer_rar_resumable` in this task — the equivalence test in Task 4 needs both paths alive.

- [ ] **Step 1: Write the worker and the send loop**

Add inside `mod rar_support`:

```rust
    /// Walk the archive on a worker thread, pushing entry-framed messages.
    ///
    /// Runs on its own thread because UnRAR pushes bytes at us while the shard
    /// sender pulls; the bounded channel between them is the backpressure, so
    /// peak memory is a few chunks rather than a whole entry.
    fn spawn_rar_worker(
        archive_path: &Path,
        password: Option<&str>,
        excludes: Vec<String>,
    ) -> (
        std::sync::mpsc::Receiver<crate::rar_stream::StreamMsg>,
        std::thread::JoinHandle<()>,
    ) {
        use crate::rar_stream::StreamMsg;

        let path_str = archive_path.to_string_lossy().into_owned();
        let password = password.map(str::to_string);
        // 4 chunks is enough to keep the sender fed without letting the worker
        // run far ahead of the network.
        let (tx, rx) = std::sync::mpsc::sync_channel::<StreamMsg>(4);

        let handle = std::thread::spawn(move || {
            let fail = |tx: &std::sync::mpsc::SyncSender<StreamMsg>, msg: String| {
                let _ = tx.send(StreamMsg::Failed(msg));
            };

            let opened = match password.as_deref() {
                Some(pw) => Archive::with_password(&path_str, pw).open_for_processing(),
                None => Archive::new(&path_str).open_for_processing(),
            };
            let mut open = match opened {
                Ok(o) => o,
                Err(e) => {
                    fail(&tx, format!("{:#}", map_rar_open_err(&path_str, "open rar", e)));
                    return;
                }
            };

            loop {
                let header = match open.read_header() {
                    Ok(Some(h)) => h,
                    Ok(None) => {
                        let _ = tx.send(StreamMsg::Finished);
                        return;
                    }
                    Err(e) => {
                        fail(&tx, format!("{:#}", map_rar_err("read rar header", e)));
                        return;
                    }
                };

                let name = header.entry().filename.clone();
                let skip_this = header.entry().is_directory()
                    || match sanitize_rar_entry(&name) {
                        None => true,
                        Some(rel) => {
                            !excludes.is_empty()
                                && crate::excludes::is_excluded_strings(
                                    Path::new(&rel),
                                    &excludes,
                                )
                        }
                    };

                if skip_this {
                    match header.skip() {
                        Ok(next) => {
                            open = next;
                            continue;
                        }
                        Err(e) => {
                            fail(&tx, format!("{:#}", map_rar_err("skip rar entry", e)));
                            return;
                        }
                    }
                }

                let rel = match sanitize_rar_entry(&name) {
                    Some(r) => r,
                    None => {
                        fail(&tx, format!("rar contains an unsafe entry path: {name:?}"));
                        return;
                    }
                };
                if tx.send(StreamMsg::Entry(rel)).is_err() {
                    return; // consumer gone (cancel or error) — unwind quietly
                }

                let (chunk_tx, chunk_rx) = std::sync::mpsc::sync_channel::<Box<[u8]>>(4);
                // Forward this entry's chunks on a helper thread so UnRAR's
                // blocking walk and our framed channel do not deadlock on each
                // other's capacity.
                let fwd_tx = tx.clone();
                let fwd = std::thread::spawn(move || {
                    for c in chunk_rx {
                        if fwd_tx.send(StreamMsg::Chunk(c)).is_err() {
                            return false;
                        }
                    }
                    true
                });

                let sink = StreamSink::new(chunk_tx);
                let result = header.read_to_sink(sink);
                let alive = fwd.join().unwrap_or(false);

                match result {
                    Ok((sink, next)) => {
                        if sink.disconnected() || !alive {
                            return; // consumer went away
                        }
                        if tx.send(StreamMsg::EntryEnd).is_err() {
                            return;
                        }
                        open = next;
                    }
                    Err(e) => {
                        fail(&tx, format!("{:#}", map_rar_err("extract rar entry", e)));
                        return;
                    }
                }
            }
        });

        (rx, handle)
    }

    /// Stream a `.rar` to the console: one forward-only decompression, shards
    /// emitted as the bytes arrive. No staging directory, so no host disk is
    /// needed beyond the archive itself.
    pub fn transfer_rar_streaming(
        cfg: &TransferConfig,
        tx_id: [u8; 16],
        dest_root: &str,
        archive_path: &Path,
        password: Option<&str>,
        flags: u32,
    ) -> Result<TransferResult> {
        use crate::rar_stream::{next_entry, EntryReader};
        use std::io::Read;

        let tx_id_hex = bytes_to_hex(&tx_id);

        // ── Planning pass ── headers only, no decompression. Sizes come from
        //    the archive metadata, so the manifest is complete before a single
        //    byte is decoded.
        let (_, plan_files) = rar_plan_preview(archive_path, password, &cfg.excludes)?;
        if plan_files.is_empty() {
            bail!(
                "rar has no extractable files (after exclusions): {}",
                archive_path.display()
            );
        }

        let mut planned_files: Vec<ManifestFile> = Vec::with_capacity(plan_files.len());
        let mut plan: Vec<(String, u64, u64)> = Vec::with_capacity(plan_files.len());
        let mut next_seq: u64 = 1;
        let mut total_bytes: u64 = 0;
        for (rel, size) in &plan_files {
            let dest_path = join_ps5_path(dest_root, Path::new(rel));
            let shard_start = next_seq;
            let shard_count = if *size == 0 {
                1
            } else {
                size.div_ceil(cfg.shard_size as u64)
            };
            next_seq += shard_count;
            total_bytes += *size;
            planned_files.push(ManifestFile {
                path: dest_path,
                size: *size,
                shard_start,
                shard_count,
            });
            plan.push((rel.clone(), *size, shard_start));
        }
        let total_shards = next_seq - 1;
        let file_count = planned_files.len() as u64;
        ensure_manifest_paths_fit(&planned_files)?;
        let manifest_json = serde_json::to_vec(&Manifest {
            dest_root: dest_root.to_string(),
            file_count,
            total_bytes,
            total_shards,
            files: planned_files,
        })?;

        let mut c = Connection::connect(&cfg.addr)?;
        let begin_ack = send_begin_and_expect_ack(
            &mut c,
            &tx_meta_buf_flags(
                tx_id,
                2,
                flags | TX_FLAG_APPLY_PROGRESS_REQUESTED,
                &manifest_json,
            ),
        )?;
        let last_acked_shard = parse_last_acked_shard(&begin_ack, flags & TX_FLAG_RESUME != 0);
        guard_last_acked(last_acked_shard, total_shards)?;

        // ── Send pass ──
        let (rx, worker) = spawn_rar_worker(archive_path, password, cfg.excludes.clone());
        let mut shards_sent = 0u64;
        let send_result = (|| -> Result<()> {
            let mut sender = PipelinedSender::new(&mut c, cfg, tx_id, total_shards);
            let mut buf = vec![0u8; cfg.shard_size];
            let mut pos = 0usize;

            while let Some(name) = next_entry(&rx)? {
                // Lock-step with the plan. Both passes walk the archive in the
                // same order, so a mismatch means something is wrong — fail
                // rather than write one file's bytes to another's dest path.
                if pos >= plan.len() || plan[pos].0 != name {
                    bail!("rar stream desynced from plan at entry {name:?}");
                }
                let (_, size, shard_start) = plan[pos].clone();
                pos += 1;

                let mut rd = EntryReader::new(&rx);
                if size == 0 {
                    // Drain the (empty) entry so framing stays aligned.
                    std::io::copy(&mut rd, &mut std::io::sink())?;
                    if shard_start > last_acked_shard {
                        sender.send_with(shard_start, &[], 1, 0)?;
                        shards_sent += 1;
                    }
                    if let Some(p) = &cfg.progress_files {
                        p.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                    continue;
                }

                let mut seq = shard_start;
                let mut remaining = size;
                while remaining > 0 {
                    let n = std::cmp::min(cfg.shard_size as u64, remaining) as usize;
                    // Enforces the header's size: a short entry errors here
                    // rather than committing a truncated file.
                    rd.read_exact(&mut buf[..n])?;
                    if seq > last_acked_shard {
                        sender.send_with(seq, &buf[..n], 1, 0)?;
                        shards_sent += 1;
                        if let Some(p) = &cfg.progress_bytes {
                            p.fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
                        }
                    }
                    seq += 1;
                    remaining -= n as u64;
                }
                // The entry must be exactly its declared size: anything left
                // means the plan and the stream disagree.
                let mut extra = [0u8; 1];
                if rd.read(&mut extra)? != 0 {
                    bail!("rar entry {name:?} produced more bytes than its header declared");
                }
                if let Some(p) = &cfg.progress_files {
                    p.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
            }

            if pos != plan.len() {
                bail!(
                    "rar stream ended after {pos} of {} planned files",
                    plan.len()
                );
            }
            sender.drain()?;
            Ok(())
        })();

        // Always release the worker: dropping the receiver unblocks it if it is
        // waiting on a full channel, and joining keeps it from outliving us.
        drop(rx);
        let _ = worker.join();
        send_result?;

        let commit_ack = send_commit_and_expect_ack(&mut c, &tx_meta_buf(tx_id, 0, b""), cfg)?;
        Ok(TransferResult {
            tx_id_hex,
            shards_sent,
            bytes_sent: total_bytes,
            dest: dest_root.to_string(),
            commit_ack_body: commit_ack,
        })
    }
```

Extend the existing import at the top of `mod rar_support` (currently `use unrar::{Archive, FileHeader};`) to `use unrar::{Archive, FileHeader, StreamSink};`, matching the re-export added in Task 1 Step 4.

- [ ] **Step 2: Build**

Run: `cd engine && cargo build -p ps5upload-core 2>&1 | grep -E '^error' -A6 | head -30`
Expected: no output. Fix real signature mismatches against the 7z loop at `transfer.rs` around line 3775, which is the reference implementation.

- [ ] **Step 3: Commit**

```bash
git add engine/crates/ps5upload-core/src/transfer.rs
git commit -m "feat(rar): streaming transfer path, alongside the staged one

Deliberately additive: the equivalence test in the next task compares
streamed output against staged output, so both have to exist at once."
```

---

### Task 4: Prove streamed output is byte-identical to staged

This is the gate. Nothing later matters if this fails.

**Files:**
- Modify: `engine/crates/ps5upload-tests/tests/transfer_rar_integration.rs`

**Interfaces:**
- Consumes: `transfer_rar_streaming` (Task 3), existing `transfer_rar_resumable`, `MockServer`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing tests**

Replace the file's body (keep the header comment and `mod mock_server;`) with:

```rust
use ps5upload_core::transfer::{
    transfer_rar_resumable, transfer_rar_streaming, TransferConfig,
};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn tx_id(seed: u8) -> [u8; 16] {
    let mut id = [0u8; 16];
    for (i, b) in id.iter_mut().enumerate() {
        *b = (i as u8).wrapping_mul(31).wrapping_add(seed);
    }
    id
}

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../ps5upload-core/testdata/rar")
        .join(name)
}

type Landed = BTreeMap<String, Vec<u8>>;

fn landed(srv: &MockServer) -> Landed {
    srv.state
        .lock()
        .unwrap()
        .applied
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

#[test]
fn streamed_output_is_byte_identical_to_staged() {
    // The load-bearing test: whatever the console ends up with must not
    // depend on which path produced it.
    let staged = {
        let srv = MockServer::start();
        let cfg = TransferConfig { shard_size: 4096, ..TransferConfig::new(&srv.addr) };
        transfer_rar_resumable(
            &cfg, tx_id(0x5C), "/data/g", &fixture("crypted.rar"), Some("unrar"), 0, 0,
        )
        .expect("staged");
        landed(&srv)
    };
    let streamed = {
        let srv = MockServer::start();
        let cfg = TransferConfig { shard_size: 4096, ..TransferConfig::new(&srv.addr) };
        transfer_rar_streaming(
            &cfg, tx_id(0x5C), "/data/g", &fixture("crypted.rar"), Some("unrar"), 0,
        )
        .expect("streamed");
        landed(&srv)
    };

    assert!(!staged.is_empty(), "fixture produced nothing — test proves nothing");
    assert_eq!(streamed, staged, "streaming landed different bytes than staging");
}

#[test]
fn a_small_shard_size_still_reassembles_correctly() {
    // Forces many shards per file, so any off-by-one in the chunk/shard
    // boundary logic shows up as wrong bytes rather than passing by luck.
    let srv = MockServer::start();
    let cfg = TransferConfig { shard_size: 7, ..TransferConfig::new(&srv.addr) };
    transfer_rar_streaming(
        &cfg, tx_id(0x21), "/data/g", &fixture("crypted.rar"), Some("unrar"), 0,
    )
    .expect("streamed");
    let got = landed(&srv);
    assert!(!got.is_empty());
    assert!(got.values().all(|v| !v.is_empty()));
}

#[test]
fn a_wrong_password_still_reports_a_password_error() {
    let srv = MockServer::start();
    let cfg = TransferConfig::new(&srv.addr);
    let err = transfer_rar_streaming(
        &cfg, tx_id(0x33), "/data/g", &fixture("crypted.rar"), Some("nope"), 0,
    )
    .unwrap_err();
    let msg = format!("{err:#}");
    assert!(msg.contains("rar_password"), "got {msg}");
}

#[test]
fn a_missing_password_still_reports_a_password_error() {
    let srv = MockServer::start();
    let cfg = TransferConfig::new(&srv.addr);
    let err = transfer_rar_streaming(
        &cfg, tx_id(0x44), "/data/g", &fixture("crypted.rar"), None, 0,
    )
    .unwrap_err();
    let msg = format!("{err:#}");
    assert!(msg.contains("rar_password"), "got {msg}");
}
```

Keep the existing `mod mock_server; use mock_server::MockServer;` lines and the `#![cfg(not(target_os = "android"))]` attribute.

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine && cargo test -p ps5upload-tests --test transfer_rar_integration 2>&1 | tail -15`
Expected: FAIL — `transfer_rar_streaming` is not exported yet.

- [ ] **Step 3: Export the streaming entry point**

In `transfer.rs`, extend the existing re-export:

```rust
pub use rar_support::{
    inspect_rar, rar_plan_preview, transfer_rar_resumable, transfer_rar_streaming,
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd engine && cargo test -p ps5upload-tests --test transfer_rar_integration 2>&1 | tail -15`
Expected: PASS, 4 tests. If the equivalence test fails, STOP — the framing or shard boundaries are wrong, and no later task can compensate.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/ps5upload-tests/tests/transfer_rar_integration.rs engine/crates/ps5upload-core/src/transfer.rs
git commit -m "test(rar): streamed upload lands byte-identical to staged

The gate for the whole change: what reaches the console must not depend on
which path produced it. Also pins password errors and a deliberately tiny
shard size, where an off-by-one at a chunk/shard boundary would otherwise
pass by luck."
```

---

### Task 5: Switch over and delete the staged path

**Files:**
- Modify: `engine/crates/ps5upload-core/src/transfer.rs`
- Modify: `engine/crates/ps5upload-core/src/lib.rs`
- Delete: `engine/crates/ps5upload-core/src/host_space.rs`
- Modify: `engine/crates/ps5upload-engine/src/lib.rs`

**Interfaces:**
- Consumes: `transfer_rar_streaming`.
- Produces: `transfer_rar_resumable` keeps its existing signature and callers, now backed by streaming.

- [ ] **Step 1: Point `transfer_rar_resumable` at streaming**

Replace its whole body with a resumable retry around the streaming call, so existing callers and retry behaviour are untouched:

```rust
    pub fn transfer_rar_resumable(
        cfg: &TransferConfig,
        tx_id: [u8; 16],
        dest_root: &str,
        archive_path: &Path,
        password: Option<&str>,
        max_retries: u32,
        initial_flags: u32,
    ) -> Result<TransferResult> {
        resumable_retry(max_retries, "transfer_rar", initial_flags, |flags| {
            transfer_rar_streaming(cfg, tx_id, dest_root, archive_path, password, flags)
        })
    }
```

- [ ] **Step 2: Delete the staged machinery**

From `transfer.rs` remove: `extract_and_transfer_batched`, `extract_rar_to_dir`, `remove_staging_dir`, `BatchBudget`, `BatchAccumulator`, `batch_tx_id`, the pre-flight block, and the `mod rar_batch_tests` module. From `lib.rs` remove `pub mod host_space;` and delete `host_space.rs`. From `TransferConfig` remove `archive_stage_budget_bytes` (struct field and the initialiser in `new`). From `engine/crates/ps5upload-engine/src/lib.rs` remove the `FTX2_ARCHIVE_STAGE_MB` block.

- [ ] **Step 3: Port the password tests**

The unit tests `content_encrypted_extract_needs_password` and `content_encrypted_extract_with_password` called `extract_rar_to_dir`. Password coverage now lives in the integration tests from Task 4, so delete those two unit tests and leave a comment where they were:

```rust
        // Password handling is covered end-to-end in
        // ps5upload-tests/tests/transfer_rar_integration.rs — the staged
        // extractor those tests used no longer exists.
```

- [ ] **Step 4: Build and run the full gate**

Run: `cd engine && cargo build --workspace 2>&1 | grep -E '^error' -A6 | head -30`
Then: `cd .. && npm run validate 2>&1 | tail -3`
Expected: `all selected checks passed`. Fix any leftover references the compiler names.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(rar): stream .rar uploads and delete the staged path

A .rar now needs no host staging directory and no free disk space beyond
the archive itself, so the pre-flight space check, the batch budget and
FTX2_ARCHIVE_STAGE_MB all become dead code and go with it."
```

---

### Task 6: Documentation

**Files:**
- Modify: `CHANGELOG.md`, `FAQ.md`, `README.md`, `TESTING.md`

- [ ] **Step 1: Changelog**

Add a new top section above the current newest version:

```markdown
## Unreleased

- **`.rar` uploads no longer need free space on your PC.** A `.rar` used
  to be extracted in full before anything was sent, so a 180 GB game
  needed 180 GB free on top of the archive. It is now decompressed and
  sent at the same time, exactly like `.7z` — nothing is written to your
  disk at all.
- Because of that, the `FTX2_ARCHIVE_STAGE_MB` setting is gone. It is no
  longer needed; you can delete it if you set it.
```

- [ ] **Step 2: FAQ**

Delete the two entries added for staging ("A big `.rar` upload fills up my PC's disk…" and "If I set a 4 GB batch size…"), and replace the disk-space answer ("My `.rar` upload failed with \"not enough space\"…") with:

```markdown
**Q: Does a `.rar` upload need free space on my PC?**
No. `.zip`, `.7z` and `.rar` are all decompressed and sent at the same
time, so nothing is written to your disk — you only need room for the
archive you already have.

This changed: older versions extracted a `.rar` in full first, which meant
a 180 GB game needed 180 GB free. If you set `FTX2_ARCHIVE_STAGE_MB` for
that, you can remove it.
```

- [ ] **Step 3: README and TESTING**

In `README.md`, update the archive-uploads bullet so `.rar` is described as streaming like the others. In `TESTING.md`, keep the multi-volume note but drop any claim that `.rar` stages to disk.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md FAQ.md README.md TESTING.md
git commit -m "docs: .rar uploads no longer need host disk space"
```

---

### Task 7: Verify against the real archive and a console

**Files:** none committed — this is verification. Any scratch test is deleted afterwards.

- [ ] **Step 1: Real multi-volume archive, header-only**

Create a temporary test `engine/crates/ps5upload-tests/tests/zz_scratch_realrar.rs` that reads `REAL_RAR` / `REAL_RAR_PW` from the environment, calls `inspect_rar` and `rar_plan_preview`, and asserts `title_id == Some("PPSA13428")` and 181 files.

Run: `cd engine && REAL_RAR='/Volumes/Storage/PS5/game_rars/[DLPSGAME.COM]-PPSA13428.part01.rar' REAL_RAR_PW='DLPSGAME.COM' cargo test -p ps5upload-tests --test zz_scratch_realrar -- --nocapture`
Expected: PASS. This crosses eight volume boundaries, so it also re-confirms the vendored volume-change fix.

- [ ] **Step 2: Real archive, streamed to the mock server**

Extend the scratch test to stream the real archive to a `MockServer` and assert every landed file's length equals its planned size. This is the first time the streaming path meets a solid, multi-volume, password-protected archive.

Expected: PASS. Peak memory should stay flat — spot-check with Activity Monitor; if it climbs toward entry size, the backpressure is broken.

- [ ] **Step 3: Real console**

With a PS5 reachable and the helper loaded, upload a real `.rar` to `/data/homebrew/` and confirm on the console that the file sizes match the archive's headers. Use the Shell screen or the file browser.

Consoles: `192.168.86.99` (Phat, FW 5.10), `192.168.86.100` (Pro, FW 9.60). Engine health: `curl -s http://127.0.0.1:19113/api/health`.

- [ ] **Step 4: Interrupted transfer**

Start a large streamed upload, kill it part-way, then start it again with the same `tx_id`. Confirm it resumes: the console keeps what it had, and the log shows shards being skipped rather than re-sent.

- [ ] **Step 5: Clean up and record**

Delete the scratch test. Add a short "verified on hardware" note to the changelog entry naming the firmware(s) tested.

```bash
rm -f engine/crates/ps5upload-tests/tests/zz_scratch_realrar.rs
git add -A && git commit -m "docs: note hardware verification for streamed .rar"
```

---

## Self-Review

**Spec coverage:** vendored sink mode → Task 1. Bridge (`StreamMsg`, `EntryReader`) → Task 2. Send loop, plan lock-step, resume rule, zero-byte entries → Task 3. Byte-identical equivalence, password errors → Task 4. Deletion list (`host_space`, `BatchBudget`, `BatchAccumulator`, `batch_tx_id`, `extract_rar_to_dir`, `remove_staging_dir`, `archive_stage_budget_bytes`, `FTX2_ARCHIVE_STAGE_MB`) and the ported password tests → Task 5. Docs → Task 6. Real archive, console, resume → Task 7.

**Cases from the spec, mapped:** directories/excluded → worker `skip()` (Task 3). Unsafe paths → worker `Failed` + planning bail. Short entry → `read_exact` fails. Long entry → the one-byte over-read check. Desync → plan lock-step. Missing volume/password → `map_rar_open_err`/`map_rar_err` in the worker. Corrupt mid-stream → `Failed`. Network drop → `resumable_retry` + `last_acked_shard`. Cancel → dropping `rx` unwinds the worker. Worker panic → channel disconnect → `UnexpectedEof`. Main errors first → `drop(rx)` then `join`. Empty archive → `bail!`. Large entry/solid/multi-volume → Task 7.

**Type consistency:** `StreamSink::new`/`disconnected`, `read_to_sink`, `StreamMsg`, `next_entry`, `EntryReader::new` are used in Tasks 2–3 exactly as Task 1–2 define them. `plan` is `Vec<(String, u64, u64)>` = (rel path, size, shard_start) in both the build and the consume loop.

**Known risk carried into execution:** the shipped `.rar` fixtures are single-entry, so CI equivalence cannot exercise a multi-entry or multi-volume stream. Task 7 is therefore not optional — it is where that coverage actually comes from.
