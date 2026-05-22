use serde::{Deserialize, Serialize};
use std::time::Duration;

const RELEASES_URL: &str = "https://api.github.com/repos/easy-lau/AiCount/releases/latest";

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    published_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LatestRelease {
    pub tag: String,
    pub name: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
}

#[tauri::command]
pub async fn check_latest_version(app_version: String) -> Result<LatestRelease, String> {
    let ua = format!("aicount/{app_version}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(ua)
        .build()
        .map_err(|e| format!("client init failed: {e}"))?;

    let resp = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时".to_string()
            } else if e.is_connect() {
                "网络错误".to_string()
            } else {
                format!("请求失败：{e}")
            }
        })?;

    if !resp.status().is_success() {
        return Err(format!("GitHub 返回 {}", resp.status().as_u16()));
    }

    let release: GhRelease = resp
        .json()
        .await
        .map_err(|e| format!("解析失败：{e}"))?;

    Ok(LatestRelease {
        tag: release.tag_name,
        name: release.name,
        html_url: release.html_url,
        published_at: release.published_at,
    })
}
