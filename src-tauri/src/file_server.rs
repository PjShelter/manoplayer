use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tiny_http::{Response, Server};

pub fn start_file_server(port: u16, base_path: Arc<Mutex<String>>) -> Result<(), String> {
    let address = format!("127.0.0.1:{port}");
    let server = Server::http(&address).map_err(|error| error.to_string())?;

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let url = request.url().to_string();
            let current_base = base_path
                .lock()
                .map(|base| base.clone())
                .unwrap_or_default();
            let response = handle_request(&url, &current_base);
            let _ = request.respond(response);
        }
    });

    Ok(())
}

fn handle_request(url: &str, base_path: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let path_part_encoded = url.split('?').next().unwrap_or(url).trim_start_matches('/');
    let path_part = urlencoding::decode(path_part_encoded)
        .map(|s| s.to_string())
        .unwrap_or_else(|_| path_part_encoded.to_string());
    let file_path = Path::new(base_path).join(path_part);

    if !file_path.exists() || !file_path.is_file() {
        return add_cors_headers(Response::from_string("File not found").with_status_code(404));
    }

    match fs::read(&file_path) {
        Ok(content) => {
            let mime_type = guess_mime_type(&file_path);
            let mut response = Response::from_data(content).with_status_code(200);
            if let Ok(header) =
                tiny_http::Header::from_bytes(&b"Content-Type"[..], mime_type.as_bytes())
            {
                response = response.with_header(header);
            }
            add_cors_headers(response)
        }
        Err(error) => add_cors_headers(
            Response::from_string(format!("Internal Server Error: {error}")).with_status_code(500),
        ),
    }
}

fn add_cors_headers(
    mut response: Response<std::io::Cursor<Vec<u8>>>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    if let Ok(header) = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*") {
        response = response.with_header(header);
    }
    response
}

fn guess_mime_type(path: &Path) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
    .to_string()
}
