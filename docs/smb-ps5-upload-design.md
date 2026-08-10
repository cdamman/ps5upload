# Design: SMB → PS5 one-step upload

**Status:** implemented on branch  
**Date:** 2026-08-10

## Problem

SMB Browser could only **download to the PC**. Users with game dumps on a
NAS still had to Save → switch to Upload → pick the path. Missing:

1. Upload a file to the PS5 in one step  
2. Stream large files without a 2 GiB in-memory cap  
3. Use a multi-file folder dump on the share as an upload source  

## Approach: stage-and-forward

```text
NAS ──SMB stream──► host temp dir ──FTX2──► PS5
     (chunked)         (job staging)   (existing transfer)
```

True zero-copy NAS→PS5 would require FTX2 to accept an arbitrary
`AsyncRead` source. That is a large core change. Staging reuses the
battle-tested transfer path and still feels like one action in the UI.

### Streaming

Uses `smb2::SmbClient::download` + `next_chunk()` so each file is written
to disk in ~64 KiB–MaxReadSize chunks. **No full-file `Vec<u8>`**, so the
old 2 GiB download limit does not apply to the PS5 path.

### Destination rule

Matches Upload: `dest_root` is the parent on the PS5; the source basename
is always appended:

- File `//nas/games/foo.pkg` + `dest_root=/data/homebrew`  
  → `/data/homebrew/foo.pkg`
- Dir `//nas/games/MyGame/` + `dest_root=/data/homebrew`  
  → `/data/homebrew/MyGame/...` (tree mirror)

### Job lifecycle

1. Create job `Running`  
2. Stage SMB → `$TMPDIR/ps5upload-smb-stage/<job_id>/`  
3. `transfer_file` or `transfer_dir` to the payload  
4. Delete the staging tree (success or failure)  

Progress counters update during both stage and transfer.

### API

`POST /api/smb/transfer`

```json
{
  "server": "192.168.1.10",
  "user": "guest",
  "password": "",
  "share": "games",
  "path": "ps5/MyGame",
  "dest_root": "/data/homebrew",
  "addr": "192.168.86.100:9113"
}
```

→ `{ "job_id": "..." }` — poll `/api/jobs/{id}` like any other transfer.

### Limits

| Limit | Value |
|---|---|
| Max files in one folder tree | 200_000 |
| Staging disk | host free space (fail if write fails) |
| Cancel | existing job cancel flag |

### Non-goals (this change)

- Writing to the SMB share from the PS5  
- Mounting SMB on the console  
- Replacing FTX2 with SMB  

## Key decisions

1. **Stage-and-forward over in-core streaming** — ship reliable UX without
   rewriting transfer.rs.  
2. **Same dest basename rule as Upload** — consistent mental model.  
3. **Chunked SMB download for the PS5 path only** — local Save dialog can
   keep the simpler path; transfer path must not OOM on large dumps.  

## PR Plan

Single PR: engine stage + transfer job, Tauri proxy, SmbBrowser UI,
unit tests for path helpers and dest resolution.
