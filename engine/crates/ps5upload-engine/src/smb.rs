//! SMB Browser: browse and download from SMB2/3 shares.
//! Engine-only — no payload component needed. Uses the pure-Rust
//! `smb2` crate for zero native dependencies.
//!
//! Credentials are sent in the POST body (not query params) for security.

use axum::body::Body;
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::json_err;

/// Classify an SMB error into an appropriate HTTP status code + message.
fn smb_err(e: anyhow::Error) -> (StatusCode, String) {
    let msg = format!("{e:#}");
    let lower = msg.to_ascii_lowercase();
    if lower.contains("auth")
        || lower.contains("logon")
        || lower.contains("credential")
        || lower.contains("denied")
        || lower.contains("nt_status_logon_failure")
    {
        (
            StatusCode::UNAUTHORIZED,
            format!("SMB authentication failed: {msg}"),
        )
    } else if lower.contains("refused")
        || lower.contains("timeout")
        || lower.contains("unreachable")
        || lower.contains("resolve")
        || lower.contains("timed out")
    {
        (
            StatusCode::BAD_GATEWAY,
            format!("SMB connection failed: {msg}"),
        )
    } else if lower.contains("not found")
        || lower.contains("no such")
        || lower.contains("bad_netpath")
    {
        (StatusCode::NOT_FOUND, format!("SMB path not found: {msg}"))
    } else {
        (StatusCode::BAD_GATEWAY, msg)
    }
}

#[derive(Debug, Deserialize)]
pub struct SmbListSharesRequest {
    pub server: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct SmbShare {
    pub name: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub share_type: String,
}

#[derive(Debug, Serialize)]
pub struct SmbListSharesResponse {
    pub shares: Vec<SmbShare>,
}

pub async fn smb_list_shares(Json(q): Json<SmbListSharesRequest>) -> impl IntoResponse {
    if q.server.trim().is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "server is required").into_response();
    }
    let r = async {
        let mut client = smb2::connect(&q.server, &q.user, &q.password)
            .await
            .map_err(|e| anyhow::anyhow!("connect: {e}"))?;
        let shares = client
            .list_shares()
            .await
            .map_err(|e| anyhow::anyhow!("list_shares: {e}"))?;
        Ok::<Vec<SmbShare>, anyhow::Error>(
            shares
                .into_iter()
                .map(|s| SmbShare {
                    name: s.name.clone(),
                    comment: s.comment.clone(),
                    share_type: format!("{:?}", s.share_type),
                })
                .collect(),
        )
    }
    .await;

    match r {
        Ok(shares) => (StatusCode::OK, Json(SmbListSharesResponse { shares })).into_response(),
        Err(e) => {
            let (code, msg) = smb_err(e);
            json_err(code, msg).into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SmbListDirRequest {
    pub server: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    pub share: String,
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct SmbDirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    #[serde(default)]
    pub modified: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SmbListDirResponse {
    pub entries: Vec<SmbDirEntry>,
}

pub async fn smb_list_dir(Json(q): Json<SmbListDirRequest>) -> impl IntoResponse {
    if q.server.trim().is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "server is required").into_response();
    }
    if q.share.trim().is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "share is required").into_response();
    }
    let r = async {
        let mut client = smb2::connect(&q.server, &q.user, &q.password)
            .await
            .map_err(|e| anyhow::anyhow!("connect: {e}"))?;
        let mut tree = client
            .connect_share(&q.share)
            .await
            .map_err(|e| anyhow::anyhow!("connect_share: {e}"))?;
        let entries = client
            .list_directory(&mut tree, &q.path)
            .await
            .map_err(|e| anyhow::anyhow!("list_directory: {e}"))?;
        Ok::<Vec<SmbDirEntry>, anyhow::Error>(
            entries
                .into_iter()
                .map(|e| SmbDirEntry {
                    name: e.name.clone(),
                    is_dir: e.is_directory,
                    size: e.size,
                    modified: if e.modified.0 == 0 {
                        None
                    } else {
                        Some(e.modified.0.to_string())
                    },
                })
                .collect(),
        )
    }
    .await;

    match r {
        Ok(entries) => (StatusCode::OK, Json(SmbListDirResponse { entries })).into_response(),
        Err(e) => {
            let (code, msg) = smb_err(e);
            json_err(code, msg).into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SmbDownloadRequest {
    pub server: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    pub share: String,
    pub path: String,
}

pub async fn smb_download_file(Json(q): Json<SmbDownloadRequest>) -> impl IntoResponse {
    if q.server.trim().is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "server is required").into_response();
    }
    if q.share.trim().is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "share is required").into_response();
    }
    if q.path.trim().is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "path is required").into_response();
    }
    let r = async {
        let mut client = smb2::connect(&q.server, &q.user, &q.password)
            .await
            .map_err(|e| anyhow::anyhow!("connect: {e}"))?;
        let mut tree = client
            .connect_share(&q.share)
            .await
            .map_err(|e| anyhow::anyhow!("connect_share: {e}"))?;

        let info = client
            .stat(&mut tree, &q.path)
            .await
            .map_err(|e| anyhow::anyhow!("stat: {e}"))?;
        const MAX_DOWNLOAD: u64 = 2 * 1024 * 1024 * 1024;
        if info.size > MAX_DOWNLOAD {
            anyhow::bail!(
                "file is {} bytes; the in-memory SMB downloader supports up to 2 GiB",
                info.size
            );
        }

        let data = client
            .read_file_pipelined(&mut tree, &q.path)
            .await
            .map_err(|e| anyhow::anyhow!("read_file: {e}"))?;
        Ok::<Vec<u8>, anyhow::Error>(data)
    }
    .await;

    match r {
        Ok(data) => {
            let filename = q
                .path
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or("download")
                .to_string();
            let mut headers = HeaderMap::new();
            headers.insert(
                HeaderName::from_static("content-type"),
                HeaderValue::from_static("application/octet-stream"),
            );
            let cd = format!("attachment; filename=\"{}\"", filename);
            if let Ok(hv) = HeaderValue::from_str(&cd) {
                headers.insert(HeaderName::from_static("content-disposition"), hv);
            }
            (StatusCode::OK, headers, Body::from(data)).into_response()
        }
        Err(e) => {
            let (code, msg) = smb_err(e);
            json_err(code, msg).into_response()
        }
    }
}
