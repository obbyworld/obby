use std::collections::HashSet;

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::net::TcpStream;
use tokio::time::{timeout_at, Instant};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use super::text::{parse_iso_time, parse_line, Line};
use super::ServerConfig;
use crate::socket::{connect_tcp, parse_address, tls_handshake, AsyncStream};

const WANTED_CAPS: [&str; 6] = [
    "sasl",
    "draft/chathistory",
    "server-time",
    "message-tags",
    "batch",
    "soju.im/bouncer-networks",
];
const TARGETS_LIMIT: usize = 50;
const HISTORY_LIMIT: usize = 100;
const MAX_TARGETS: usize = 20;

/// A PRIVMSG from history, with the chat it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryMessage {
    pub chat: String,
    pub source: String,
    pub text: String,
    pub time: i64,
    pub msgid: Option<String>,
    pub is_private: bool,
}

enum Conn {
    Stream {
        reader: BufReader<ReadHalf<Box<dyn AsyncStream>>>,
        writer: WriteHalf<Box<dyn AsyncStream>>,
    },
    WebSocket(Box<WebSocketStream<MaybeTlsStream<TcpStream>>>),
}

impl Conn {
    async fn open(address: &str) -> Result<Self, String> {
        if address.starts_with("wss://") || address.starts_with("ws://") {
            let (socket, _) = tokio_tungstenite::connect_async(address)
                .await
                .map_err(|e| format!("WebSocket connect to {address} failed: {e}"))?;
            return Ok(Conn::WebSocket(Box::new(socket)));
        }
        let (use_tls, host, port) = parse_address(address)?;
        let tcp = connect_tcp(&host, port).await?;
        let stream: Box<dyn AsyncStream> = if use_tls {
            tls_handshake(&host, tcp).await?
        } else {
            Box::new(tcp)
        };
        let (reader, writer) = tokio::io::split(stream);
        Ok(Conn::Stream {
            reader: BufReader::new(reader),
            writer,
        })
    }

    async fn send(&mut self, line: &str) -> Result<(), String> {
        match self {
            Conn::Stream { writer, .. } => writer
                .write_all(format!("{line}\r\n").as_bytes())
                .await
                .map_err(|e| e.to_string()),
            Conn::WebSocket(socket) => socket
                .send(WsMessage::text(line))
                .await
                .map_err(|e| e.to_string()),
        }
    }

    async fn recv(&mut self) -> Result<Option<String>, String> {
        match self {
            Conn::Stream { reader, .. } => {
                let mut buffer = String::new();
                let read = reader
                    .read_line(&mut buffer)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok((read > 0).then_some(buffer))
            }
            Conn::WebSocket(socket) => loop {
                match socket.next().await {
                    Some(Ok(WsMessage::Text(text))) => return Ok(Some(text.to_string())),
                    Some(Ok(WsMessage::Binary(bytes))) => {
                        return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
                    }
                    Some(Ok(WsMessage::Close(_))) | None => return Ok(None),
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return Err(e.to_string()),
                }
            },
        }
    }
}

struct Session {
    conn: Conn,
    deadline: Instant,
    nick: String,
    chantypes: String,
}

impl Session {
    async fn send(&mut self, line: &str) -> Result<(), String> {
        timeout_at(self.deadline, self.conn.send(line))
            .await
            .map_err(|_| "timed out".to_string())?
    }

    /// The next line, answering PINGs on the way.
    async fn next(&mut self) -> Result<Line, String> {
        loop {
            let raw = timeout_at(self.deadline, self.conn.recv())
                .await
                .map_err(|_| "timed out".to_string())??
                .ok_or("connection closed")?;
            let line = parse_line(&raw);
            if line.command == "PING" {
                let token = line.param(0).to_string();
                self.send(&format!("PONG :{token}")).await?;
                continue;
            }
            if line.command == "ERROR" {
                return Err(format!("server closed the link: {}", line.param(0)));
            }
            return Ok(line);
        }
    }

    async fn register(&mut self, server: &ServerConfig) -> Result<HashSet<String>, String> {
        self.send("CAP LS 302").await?;
        if let Some(password) = &server.server_password {
            self.send(&format!("PASS {password}")).await?;
        }
        self.send(&format!("NICK {}", self.nick)).await?;
        self.send(&format!("USER {} 0 * :Obby", self.nick)).await?;

        let mut offered: HashSet<String> = HashSet::new();
        let mut acked: HashSet<String> = HashSet::new();
        let mut nick_attempts = 0;
        loop {
            let line = self.next().await?;
            match line.command.as_str() {
                "CAP" => match line.param(1) {
                    "LS" => {
                        let is_last = line.param(2) != "*";
                        let caps = line.params.last().map(String::as_str).unwrap_or("");
                        for cap in caps.split(' ').filter(|c| !c.is_empty()) {
                            offered.insert(cap.split('=').next().unwrap_or(cap).to_string());
                        }
                        if !is_last {
                            continue;
                        }
                        let wanted: Vec<&str> = WANTED_CAPS
                            .into_iter()
                            .filter(|cap| offered.contains(*cap))
                            .filter(|cap| *cap != "sasl" || server.account.is_some())
                            .collect();
                        if wanted.is_empty() {
                            self.send("CAP END").await?;
                        } else {
                            self.send(&format!("CAP REQ :{}", wanted.join(" "))).await?;
                        }
                    }
                    "ACK" => {
                        let caps = line.params.last().map(String::as_str).unwrap_or("");
                        acked.extend(caps.split(' ').filter(|c| !c.is_empty()).map(String::from));
                        if line.param(2) == "*" {
                            continue;
                        }
                        if acked.contains("sasl") {
                            self.send("AUTHENTICATE PLAIN").await?;
                        } else {
                            self.finish_caps(server, &acked).await?;
                        }
                    }
                    "NAK" => self.finish_caps(server, &acked).await?,
                    _ => {}
                },
                "AUTHENTICATE" if line.param(0) == "+" => {
                    let account = server.account.as_deref().unwrap_or_default();
                    let password = server.password.as_deref().unwrap_or_default();
                    let payload = base64::engine::general_purpose::STANDARD
                        .encode(format!("{account}\0{account}\0{password}"));
                    self.send(&format!("AUTHENTICATE {payload}")).await?;
                }
                "903" => self.finish_caps(server, &acked).await?,
                "902" | "904" | "905" | "906" => {
                    return Err(format!("SASL login failed ({})", line.command))
                }
                // A persistent account answers "nick in use" before SASL ends,
                // then attaches us to its session under that nick anyway.
                "433" if server.account.is_some() => {}
                "433" | "432" if nick_attempts < 3 => {
                    nick_attempts += 1;
                    self.nick.push('_');
                    self.send(&format!("NICK {}", self.nick)).await?;
                }
                "001" => {
                    if let Some(nick) = line.params.first() {
                        self.nick = nick.clone();
                    }
                }
                "005" => {
                    for token in &line.params {
                        if let Some(types) = token.strip_prefix("CHANTYPES=") {
                            self.chantypes = types.to_string();
                        }
                    }
                }
                "376" | "422" => return Ok(acked),
                _ => {}
            }
        }
    }

    async fn finish_caps(
        &mut self,
        server: &ServerConfig,
        acked: &HashSet<String>,
    ) -> Result<(), String> {
        if let Some(netid) = &server.bouncer_netid {
            if acked.contains("soju.im/bouncer-networks") {
                self.send(&format!("BOUNCER BIND {netid}")).await?;
            }
        }
        self.send("CAP END").await
    }

    /// The lines of one batch the server opens in answer to `request`.
    async fn batch(&mut self, request: &str) -> Result<Vec<Line>, String> {
        self.send(request).await?;
        let mut batch_id: Option<String> = None;
        let mut lines = Vec::new();
        loop {
            let line = self.next().await?;
            if line.command == "FAIL" && line.param(0) == "CHATHISTORY" {
                return Ok(lines);
            }
            if line.command == "BATCH" {
                let reference = line.param(0);
                if let Some(id) = reference.strip_prefix('+') {
                    if batch_id.is_none() {
                        batch_id = Some(id.to_string());
                    }
                } else if reference.strip_prefix('-') == batch_id.as_deref() {
                    return Ok(lines);
                }
                continue;
            }
            if batch_id.is_some() && line.tags.get("batch") == batch_id.as_ref() {
                lines.push(line);
            }
        }
    }
}

/// Logs in without joining anything, reads what arrived since `since`, and
/// drops the connection. We send no QUIT: on a persistent account it would end
/// the always-on presence along with this session.
pub async fn fetch_history(
    server: &ServerConfig,
    since: i64,
    now: i64,
    deadline: Instant,
) -> Result<Vec<HistoryMessage>, String> {
    let conn = timeout_at(deadline, Conn::open(&server.address))
        .await
        .map_err(|_| "timed out connecting".to_string())??;
    let mut session = Session {
        conn,
        deadline,
        nick: server.nick.clone(),
        chantypes: "#&+!^$".to_string(),
    };
    let acked = session.register(server).await?;
    if !acked.contains("draft/chathistory") {
        return Err("server offers no chat history".into());
    }

    let since_iso = super::text::iso_time(since);
    let targets_request = format!(
        "CHATHISTORY TARGETS timestamp={since_iso} timestamp={} {TARGETS_LIMIT}",
        super::text::iso_time(now)
    );
    let targets: Vec<String> = session
        .batch(&targets_request)
        .await?
        .into_iter()
        .filter(|line| line.command == "CHATHISTORY" && line.param(0) == "TARGETS")
        .map(|line| line.param(1).to_string())
        .filter(|target| !target.is_empty())
        .take(MAX_TARGETS)
        .collect();

    let mut messages = Vec::new();
    for target in targets {
        let is_private = !target
            .chars()
            .next()
            .is_some_and(|first| session.chantypes.contains(first));
        let request = format!("CHATHISTORY AFTER {target} timestamp={since_iso} {HISTORY_LIMIT}");
        for line in session.batch(&request).await? {
            if line.command != "PRIVMSG" {
                continue;
            }
            let Some(time) = line.tags.get("time").and_then(|t| parse_iso_time(t)) else {
                continue;
            };
            messages.push(HistoryMessage {
                chat: target.clone(),
                source: line.source.clone(),
                text: line.param(1).to_string(),
                time,
                msgid: line.tags.get("msgid").cloned(),
                is_private,
            });
        }
    }
    Ok(messages)
}
