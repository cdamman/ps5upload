//! Integration tests for the `.rar` transfer path, focused on batched
//! extraction (#251).
//!
//! Uploading a `.rar` normally extracts the whole archive into a host
//! staging directory before sending any of it, so a 100 GB game needs
//! 100 GB free on the PC. `archive_stage_budget_bytes` bounds how much
//! sits there at once: extract to the budget, send that batch, delete it,
//! continue.
//!
//! The property that matters is that batching is *invisible on the
//! console*: the same files must land, byte for byte, whichever mode ran.
//! These tests assert exactly that by running both against the mock FTX2
//! server and comparing what was applied.

#![cfg(not(target_os = "android"))]

mod mock_server;
use mock_server::MockServer;

use ps5upload_core::transfer::{transfer_rar_resumable, TransferConfig};
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

/// Upload `crypted.rar` and return (files applied, transactions used).
///
/// `budget` of 0 is the unbatched path. A tiny non-zero budget forces a
/// flush between every entry, which is the most aggressive batching the
/// code can do — if the two agree, the middle ground does too.
fn run(budget: u64, seed: u8) -> (BTreeMap<String, Vec<u8>>, usize) {
    let srv = MockServer::start();
    let cfg = TransferConfig {
        shard_size: 4096,
        archive_stage_budget_bytes: budget,
        ..TransferConfig::new(&srv.addr)
    };
    transfer_rar_resumable(
        &cfg,
        tx_id(seed),
        "/data/g",
        &fixture("crypted.rar"),
        Some("unrar"),
        0,
        0,
    )
    .expect("rar transfer");

    let st = srv.state.lock().unwrap();
    let applied: BTreeMap<String, Vec<u8>> = st
        .applied
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    (applied, st.txs.len())
}

#[test]
fn batched_mode_lands_exactly_what_unbatched_does() {
    // The shipped fixtures hold a single entry each (we cannot generate new
    // .rar fixtures — RAR compression is proprietary and no compressor is
    // available in this environment), so this cannot exercise a split. What
    // it does prove is that the batched code path runs end to end against a
    // real archive and produces byte-identical output — i.e. turning the
    // budget on does not change what lands on the console.
    //
    // The batch *boundaries* are covered separately, and directly, by the
    // `BatchAccumulator` tests in transfer.rs, which drive the same object
    // this loop uses.
    let (unbatched, unbatched_txs) = run(0, 0x5C);
    let (batched, batched_txs) = run(1, 0x5C);

    assert!(
        !unbatched.is_empty(),
        "fixture produced no files — the test would prove nothing"
    );
    assert_eq!(
        batched, unbatched,
        "batched upload landed different content than the unbatched upload"
    );
    assert_eq!(unbatched_txs, 1);
    // One entry cannot be split however small the budget, so this stays 1.
    assert_eq!(batched_txs, 1);
}

#[test]
fn a_budget_larger_than_the_archive_behaves_like_unbatched() {
    let (unbatched, _) = run(0, 0x11);
    let (single_batch, txs) = run(64 * 1024 * 1024, 0x11);
    assert_eq!(single_batch, unbatched);
    assert_eq!(txs, 1, "one batch should mean one transaction");
}
