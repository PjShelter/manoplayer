use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

mod file_server;

#[derive(Default)]
struct FileServerState {
    port: Option<u16>,
    base_path: Arc<Mutex<String>>,
}

static FILE_SERVER_STATE: OnceLock<Mutex<FileServerState>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadedCharacterModel {
    model_path: String,
    base_dir: String,
    server_url: String,
    revision: u64,
    model: Value,
}

fn normalize_asset_path(base_dir: &Path, raw_path: &str) -> PathBuf {
    let candidate = Path::new(raw_path);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base_dir.join(candidate)
    }
}

fn relative_asset_path(base_dir: &Path, absolute_path: &Path) -> String {
    absolute_path
        .strip_prefix(base_dir)
        .unwrap_or(absolute_path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn latest_modified_recursive(path: &Path) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("读取文件元数据失败: {error}"))?;
    let mut latest = metadata
        .modified()
        .map_err(|error| format!("获取文件修改时间失败: {error}"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("转换修改时间失败: {error}"))?
        .as_millis() as u64;

    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| format!("读取目录失败: {error}"))? {
            let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
            let child_latest = latest_modified_recursive(&entry.path())?;
            latest = latest.max(child_latest);
        }
    }

    Ok(latest)
}

fn find_available_port(start_port: u16) -> Option<u16> {
    use std::net::TcpListener;

    for port in start_port..=start_port + 100 {
        if TcpListener::bind(format!("127.0.0.1:{port}")).is_ok() {
            return Some(port);
        }
    }

    None
}

fn start_or_update_file_server(base_path: &Path) -> Result<String, String> {
    let state = FILE_SERVER_STATE.get_or_init(|| {
        Mutex::new(FileServerState {
            port: None,
            base_path: Arc::new(Mutex::new(String::new())),
        })
    });

    let mut state = state
        .lock()
        .map_err(|_| "文件服务器状态锁定失败".to_string())?;

    {
        let mut current_base = state
            .base_path
            .lock()
            .map_err(|_| "文件服务器基础路径锁定失败".to_string())?;
        *current_base = base_path.to_string_lossy().replace('\\', "/");
    }

    if state.port.is_none() {
        let port = find_available_port(18021).ok_or_else(|| "找不到可用端口".to_string())?;
        file_server::start_file_server(port, Arc::clone(&state.base_path))
            .map_err(|error| format!("启动本地资源服务器失败: {error}"))?;
        state.port = Some(port);
    }

    Ok(format!(
        "http://127.0.0.1:{}",
        state.port.expect("port initialized")
    ))
}

fn load_character_model_inner(model_path: &str) -> Result<LoadedCharacterModel, String> {
    let model_file = PathBuf::from(model_path);
    let model_text = fs::read_to_string(&model_file)
        .map_err(|error| format!("读取模型文件失败: {error}"))?;

    let mut model_json: Value =
        serde_json::from_str(&model_text).map_err(|error| format!("解析 JSON 失败: {error}"))?;

    let model_dir = model_file
        .parent()
        .ok_or_else(|| "无法获取模型所在目录".to_string())?;

    let base_path = model_json
        .pointer("/settings/basePath")
        .and_then(Value::as_str)
        .unwrap_or(".");
    let resolved_base_dir = if Path::new(base_path).is_absolute() {
        PathBuf::from(base_path)
    } else {
        model_dir.join(base_path)
    };
    let server_url = start_or_update_file_server(&resolved_base_dir)?;
    let revision = latest_modified_recursive(&resolved_base_dir)?;

    let layers = model_json
        .pointer_mut("/assets/layers")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "模型缺少 assets.layers".to_string())?;

    for layer in layers.iter_mut() {
        if let Some(raw_path) = layer.get("path").and_then(Value::as_str) {
            let absolute_path = normalize_asset_path(&resolved_base_dir, raw_path);
            let relative_path = relative_asset_path(&resolved_base_dir, &absolute_path);
            if let Some(path_field) = layer.get_mut("path") {
                *path_field = Value::String(relative_path);
            }
        }
    }

    Ok(LoadedCharacterModel {
        model_path: model_file.to_string_lossy().replace('\\', "/"),
        base_dir: resolved_base_dir.to_string_lossy().replace('\\', "/"),
        server_url,
        revision,
        model: model_json,
    })
}

#[tauri::command]
fn load_character_model(model_path: String) -> Result<LoadedCharacterModel, String> {
    load_character_model_inner(&model_path)
}

#[tauri::command]
fn get_character_revision(model_path: String) -> Result<u64, String> {
    let loaded = load_character_model_inner(&model_path)?;
    Ok(loaded.revision)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_character_model,
            get_character_revision
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
