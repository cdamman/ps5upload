# Streaming `.rar` uploads — design

**Status:** approved, ready for implementation plan
**Date:** 2026-08-19

## Problem

A `.rar` upload extracts to a host staging directory before sending any
bytes. A 180 GB game therefore needs 180 GB free on the PC *on top of*
the archive. One user hit exactly this: `extract rar entry: Write error`
five minutes in, with tens of GB written and a part-extracted staging
folder left behind. `.zip` and `.7z` have never had this problem — they
decompress and stream straight into the shard pipeline.

5.3.1–5.3.3 softened it (a pre-flight space check, an opt-in batch
budget) but did not remove it. This removes it.

## Decision

Stream `.rar` the way `.7z` already streams, and **delete the staged
path entirely**. No staging directory, no host disk requirement, no
pre-flight space check.

Deleted as dead code:

- `engine/crates/ps5upload-core/src/host_space.rs` (whole module + tests)
- `TransferConfig::archive_stage_budget_bytes` and `FTX2_ARCHIVE_STAGE_MB`
- `BatchBudget`, `BatchAccumulator`, `batch_tx_id`,
  `extract_and_transfer_batched`, `extract_rar_to_dir`,
  `remove_staging_dir` and their tests
- `rar_staging_no_space` / `rar_staging_write_failed` error strings
  (engine-only — verified: the client never mapped them)
- The FAQ answers about RAR disk space and batch size

**Not deleted — ported.** Three tests currently exercise password
handling through `extract_rar_to_dir`
(`content_encrypted_extract_needs_password`, `..._with_password`, and the
wrong-password case). Password behaviour is not staging-specific and must
survive, so these are rewritten against the streaming path rather than
removed with it. `rar_missing_volume` and its client mapping also stay —
unrelated to staging.

## Why this shape

UnRAR's C API already delivers decompressed data incrementally: on
`UCM_PROCESSDATA` the callback receives `slice_from_raw_parts(p1, p2)`.
The Rust wrapper's `ReadToVec` mode simply accumulates those chunks into
a `Vec`. `ReadToVec` runs under `Operation::Test` (`RAR_TEST`), which
decompresses **without writing files to disk** — the exact primitive
streaming needs.

The mismatch is direction: UnRAR *pushes*, `PipelinedSender` *pulls*.
A worker thread plus a bounded channel bridges them, which lets the send
loop be structurally identical to the 7z loop — same sender, same
resume, same desync check — rather than a second bespoke pipeline.

Rejected alternatives:

- **Send from inside the C callback.** No thread, but network I/O inside
  a C callback, errors cannot unwind through C, and the resume/skip
  logic would be reimplemented somewhere hard to test.
- **`read() -> Vec<u8>` per entry.** No vendored change, but buffers a
  whole entry in RAM. Game dumps carry 30 GB+ single files. Non-starter.

## Architecture

Three units, each testable alone.

### 1. Vendored crate: a sink process-mode

`third_party/unrar/src/open_archive.rs`, marked like the existing fix.

```rust
pub struct StreamSink { /* SyncSender<Box<[u8]>> + disconnected flag */ }
struct ReadToSink;                      // Operation::Test, Output = StreamSink
```

`process_file_raw` builds its `Output` with `Default::default()`, so a
seeded variant is added; the existing entry point delegates to it with
the default. Public API:

```rust
impl OpenArchive<Process, CursorBeforeFile> {
    pub fn read_to_sink(self, sink: StreamSink)
        -> UnrarResult<(StreamSink, OpenArchive<Process, CursorBeforeHeader>)>;
}
```

`process_data` forwards each chunk to the channel. A failed send (the
consumer went away) sets `disconnected`; it must not panic — it is
running inside a C callback.

### 2. Engine: the bridge

`transfer.rs`, inside `rar_support`.

Worker thread owns the archive handle and walks entries in archive
order, emitting:

```rust
enum StreamMsg {
    Entry(String),      // sanitised relative path, start of an entry
    Chunk(Box<[u8]>),
    EntryEnd,
    Finished,
    Failed(String),
}
```

Directories and excluded entries are `skip()`ed and never announced.
The channel is bounded (4 chunks), which is the backpressure: the worker
blocks while the sender is busy, so peak RAM is a few chunks plus one
shard buffer.

`EntryReader` implements `Read` over the receiver for one entry: it
returns `Ok(0)` at `EntryEnd`, holds a leftover buffer for partial
chunks, and turns `Failed`/disconnect into an `io::Error`.

### 3. Engine: the send loop

A near-copy of the 7z loop, and deliberately so:

- plan from `rar_plan_preview` (headers only — sizes known up front)
- `PipelinedSender::new(...)`, `send_with(seq, ...)` per shard
- `if seq > last_acked_shard` — decode but do not send what the console
  already has. This *is* the chosen resume semantics.
- zero-byte entries send one empty shard
- lock-step desync check against the plan
- `sender.drain()`, then commit

## Cases

| Case | Behaviour |
|---|---|
| Directory entry | `skip()`, no manifest entry, never announced |
| Zero-byte file | one empty shard, matching 7z |
| Excluded entry | `skip()`, not streamed; plan excludes it too |
| Unsafe/zip-slip path | `rar_plan_preview` already bails before any transfer |
| Entry shorter than its header | `read_exact` fails → error, no silent truncation |
| Entry longer than its header | leftover bytes at `EntryEnd` → desync error |
| Plan/stream order diverges | fail loudly, never write bytes to a wrong dest |
| Password missing/wrong | unchanged: `rar_password_required` / `_wrong` |
| Missing volume | unchanged: `rar_missing_volume: <file>` |
| Corrupt mid-stream | worker emits `Failed`, main returns the error |
| Network drop | sender errors; retry reopens the archive with `TX_FLAG_RESUME` and skips acked shards |
| Cancellation (`cfg.cancel`) | main stops; dropping the receiver makes the worker's next send fail so it unwinds |
| Worker panics | channel disconnects; main reports it rather than hanging |
| Main errors first | receiver dropped → worker unwinds → thread joined, never detached |
| Empty archive / all excluded | `rar has no extractable files` |
| Single 30 GB+ entry | streams; peak RAM is a few chunks |
| Solid archive | fine — forward-only, in order |
| Multi-volume | fine — volume-change callback already fixed in the vendored crate |
| Bandwidth cap / progress | unchanged, handled inside `PipelinedSender` |

The worker thread is **always joined**, and its error takes precedence
over a generic channel-disconnect message so the real cause surfaces.

## Testing

1. **Unit** — `EntryReader` framing: chunk reassembly, partial reads,
   `EntryEnd` as EOF, disconnect as error, `Failed` propagation.
2. **Vendored crate** — a sink-mode test proving chunks arrive and
   concatenate to the same bytes `read()` returns.
3. **Integration (mock FTX2 server)** — the load-bearing one: a streamed
   upload must land **byte-identical** to what the staged path produced,
   asserted against `MockState::applied`. Plus resume (planted
   `last_acked_shard`, assert skipped shards are not re-sent) and
   cancellation.
4. **Real archive** — the user's 9-part, 127 GB `PPSA13428` set:
   metadata, plan, and a streamed upload.
5. **Real console** — upload to a PS5, then compare checksums on the
   console against the host. This is the acceptance gate.

## Risks

- **Riskiest code path in the repo.** A bug here corrupts a 100 GB
  install. Mitigated by byte-identical equivalence testing before any
  hardware run, and by reusing the proven 7z loop rather than inventing.
- **Resume costs decompression time.** Accepted deliberately: a drop
  re-decompresses from the start. No extra disk, predictable, and it is
  what `.7z` already does.
- **No staged fallback after deletion.** If streaming proves unstable on
  hardware, the fix is forward (fix the stream), not a flag flip. The
  deleted code stays in git history.
