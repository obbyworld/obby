use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

// iOS and macOS load the app from the tauri: scheme, which sends YouTube no
// referrer, so YouTube refuses the embed (error 153). We serve the player page
// from loopback instead, which gives the embed a real http origin.
const PAGE: &str = include_str!("../youtube-embed.html");
const PAGE_PATH: &str = "/youtube-embed.html";

pub struct YoutubePlayerPort(pub Option<u16>);

pub fn start() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || serve(stream));
        }
    });
    Some(port)
}

fn serve(mut stream: TcpStream) {
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    // We read the headers to the end so closing the socket does not reset it
    // under the browser while it is still sending.
    let mut header = String::new();
    while reader.read_line(&mut header).is_ok_and(|n| n > 2) {
        header.clear();
    }

    let mut parts = request_line.split_whitespace();
    let is_page = parts.next() == Some("GET")
        && parts.next().and_then(|target| target.split('?').next()) == Some(PAGE_PATH);
    let (status, body) = if is_page {
        ("200 OK", PAGE)
    } else {
        ("404 Not Found", "")
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

#[tauri::command]
pub fn youtube_player_port(state: tauri::State<YoutubePlayerPort>) -> Option<u16> {
    state.0
}
