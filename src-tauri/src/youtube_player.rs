use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

// iOS and macOS load the app from the tauri: scheme, which sends YouTube no
// referrer, so YouTube refuses the embed (error 153). We serve the player page
// from loopback instead, which gives the embed a real http origin.
const PAGE: &str = include_str!("../youtube-embed.html");
const PAGE_PATH: &str = "/youtube-embed.html";

pub struct YoutubePlayerPort(pub Option<u16>);

const RETRY_DELAY: Duration = Duration::from_millis(250);
#[cfg(target_os = "ios")]
const REBIND_ATTEMPTS: u32 = 120;

pub fn start() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    std::thread::spawn(move || accept_forever(listener, port));
    Some(port)
}

#[cfg_attr(not(target_os = "ios"), allow(unused_variables, unused_mut))]
fn accept_forever(mut listener: TcpListener, port: u16) {
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                std::thread::spawn(move || serve(stream));
            }
            Err(error) if is_transient(error.kind()) => {}
            Err(_) => {
                std::thread::sleep(RETRY_DELAY);
                // iOS takes listening sockets away from a suspended app (Apple
                // TN2277), so we reopen the same port; the page keeps its origin.
                #[cfg(target_os = "ios")]
                {
                    drop(listener);
                    match rebind(port) {
                        Some(reopened) => listener = reopened,
                        None => return,
                    }
                }
            }
        }
    }
}

fn is_transient(kind: ErrorKind) -> bool {
    matches!(
        kind,
        ErrorKind::ConnectionAborted | ErrorKind::Interrupted | ErrorKind::WouldBlock
    )
}

#[cfg(target_os = "ios")]
fn rebind(port: u16) -> Option<TcpListener> {
    (0..REBIND_ATTEMPTS).find_map(|_| {
        let listener = TcpListener::bind(("127.0.0.1", port)).ok();
        if listener.is_none() {
            std::thread::sleep(RETRY_DELAY);
        }
        listener
    })
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
