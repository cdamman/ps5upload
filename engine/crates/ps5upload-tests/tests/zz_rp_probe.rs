#![cfg(not(target_os = "android"))]
use ps5upload_core::remoteplay;
#[test]
fn probe() {
    let addr = std::env::var("PS5_MGMT").unwrap();
    match remoteplay::remoteplay_request(&addr, None) {
        Ok(()) => println!("request accepted"),
        Err(e) => println!("request error: {e:#}"),
    }
    std::thread::sleep(std::time::Duration::from_secs(2));
    match remoteplay::remoteplay_status(&addr) {
        Ok(s) => println!("STATUS: {s:?}"),
        Err(e) => println!("status error: {e:#}"),
    }
}
