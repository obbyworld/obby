use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio::task;
use tokio::time::{timeout, Duration};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const TLS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

// Platform-specific TLS imports
#[cfg(not(target_os = "android"))]
use tokio_native_tls::TlsConnector;
#[cfg(not(target_os = "android"))]
use native_tls::TlsConnector as NativeTlsConnector;

#[cfg(target_os = "android")]
use tokio_rustls::TlsConnector;
#[cfg(target_os = "android")]
use rustls::pki_types::ServerName;
#[cfg(target_os = "android")]
use std::sync::Arc as StdArc;
#[cfg(target_os = "android")]
use webpki_roots;

/// Connection handle for managing write operations and shutdown
#[derive(Debug)]
pub struct ConnectionHandle {
    write_tx: mpsc::Sender<String>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

/// Socket state to manage multiple connections
pub struct SocketState(pub(crate) Arc<Mutex<HashMap<String, ConnectionHandle>>>);

/// Payload we send back to TS whenever we receive data
#[derive(Serialize, Clone)]
struct ReceivedPayload {
    id: String,
    event: MessageEvent,
}

#[derive(Serialize, Clone)]
struct MessageEvent {
    message: Option<MessageData>,
    error: Option<String>,
    connected: Option<bool>,
}

#[derive(Serialize, Clone)]
struct MessageData {
    data: Vec<u8>,
}

/// Read task for handling incoming data from the socket
async fn read_task<R>(
    client_id: String,
    mut reader: R,
    app_handle: tauri::AppHandle,
    state: Arc<Mutex<HashMap<String, ConnectionHandle>>>,
) where
    R: AsyncReadExt + Unpin,
{
    let mut read_buf = vec![0u8; 4096];
    let mut line_buffer = Vec::new();

    loop {
        match reader.read(&mut read_buf).await {
            Ok(0) => {
                // Connection closed by server
                // Emit any remaining partial data as a final message
                if !line_buffer.is_empty() {
                    let _ = app_handle.emit("tcp-message", ReceivedPayload {
                        id: client_id.clone(),
                        event: MessageEvent {
                            message: Some(MessageData { data: line_buffer.clone() }),
                            error: None,
                            connected: None,
                        },
                    });
                }

                let _ = app_handle.emit("tcp-message", ReceivedPayload {
                    id: client_id.clone(),
                    event: MessageEvent {
                        message: None,
                        error: None,
                        connected: Some(false),
                    },
                });

                // Remove connection from state
                let mut connections = state.lock().await;
                connections.remove(&client_id);
                break;
            }
            Ok(n) => {
                // Append new data to line buffer
                line_buffer.extend_from_slice(&read_buf[..n]);

                // Extract complete lines (ending with \r\n)
                loop {
                    if let Some(pos) = line_buffer.windows(2).position(|w| w == b"\r\n") {
                        // Extract the complete line including \r\n
                        let line_data = line_buffer[..pos + 2].to_vec();

                        // Remove the line from buffer
                        line_buffer.drain(..pos + 2);

                        // Emit the complete line
                        let _ = app_handle.emit("tcp-message", ReceivedPayload {
                            id: client_id.clone(),
                            event: MessageEvent {
                                message: Some(MessageData { data: line_data }),
                                error: None,
                                connected: None,
                            },
                        });
                    } else {
                        // No complete line found, wait for more data
                        break;
                    }
                }
            }
            Err(e) => {
                // Read error - emit error event and stop
                let _ = app_handle.emit("tcp-message", ReceivedPayload {
                    id: client_id.clone(),
                    event: MessageEvent {
                        message: None,
                        error: Some(format!("Read error: {}", e)),
                        connected: Some(false),
                    },
                });

                // Remove connection from state
                let mut connections = state.lock().await;
                connections.remove(&client_id);
                break;
            }
        }
    }
}

/// Write task for handling outgoing data to the socket
async fn write_task<W>(
    mut writer: W,
    mut write_rx: mpsc::Receiver<String>,
    mut shutdown_rx: oneshot::Receiver<()>,
) where
    W: AsyncWriteExt + Unpin,
{
    loop {
        tokio::select! {
            // Handle write commands
            Some(data) = write_rx.recv() => {
                // Add IRC line ending if not present
                let data_with_crlf = if data.ends_with("\r\n") {
                    data
                } else {
                    format!("{}\r\n", data)
                };

                if let Err(e) = writer.write_all(data_with_crlf.as_bytes()).await {
                    eprintln!("Write error: {}", e);
                    break;
                }

                if let Err(e) = writer.flush().await {
                    eprintln!("Flush error: {}", e);
                    break;
                }
            }
            // Handle shutdown signal
            _ = &mut shutdown_rx => {
                let _ = writer.shutdown().await;
                break;
            }
        }
    }
}

/// Connect to IRC server with real TCP/TLS implementation
#[tauri::command]
pub async fn connect(
    client_id: String,
    address: String,
    state: State<'_, SocketState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Parse the address to determine protocol and extract host:port
    let (use_tls, host, port) = parse_address(&address)?;

    // Create TCP connection with a hard timeout so a stalled SYN/SYN-ACK
    // surfaces as a clear error instead of hanging on kernel retransmits.
    let tcp_stream = timeout(
        CONNECT_TIMEOUT,
        TcpStream::connect(format!("{}:{}", host, port)),
    )
    .await
    .map_err(|_| {
        format!(
            "TCP connect timed out after {}s ({}:{})",
            CONNECT_TIMEOUT.as_secs(),
            host,
            port
        )
    })?
    .map_err(|e| format!("Failed to connect to {}:{}: {}", host, port, e))?;

    // Create channels for write operations
    let (write_tx, write_rx) = mpsc::channel::<String>(100);
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    // Handle TLS if needed
    if use_tls {
        // Create TLS connection based on platform
        #[cfg(not(target_os = "android"))]
        {
            let connector = TlsConnector::from(
                NativeTlsConnector::builder()
                    .build()
                    .map_err(|e| format!("Failed to create TLS connector: {}", e))?
            );

            let tls_stream = timeout(
                TLS_HANDSHAKE_TIMEOUT,
                connector.connect(&host, tcp_stream),
            )
            .await
            .map_err(|_| {
                format!(
                    "TLS handshake timed out after {}s ({})",
                    TLS_HANDSHAKE_TIMEOUT.as_secs(),
                    host
                )
            })?
            .map_err(|e| format!("TLS handshake failed: {}", e))?;

            // Split the TLS stream using tokio::io::split
            let (reader, writer) = tokio::io::split(tls_stream);

            // Spawn read task
            let client_id_read = client_id.clone();
            let app_handle_read = app_handle.clone();
            let state_clone = state.0.clone();
            task::spawn(async move {
                read_task(client_id_read, reader, app_handle_read, state_clone).await;
            });

            // Spawn write task
            task::spawn(async move {
                write_task(writer, write_rx, shutdown_rx).await;
            });
        }

        #[cfg(target_os = "android")]
        {
            // Create rustls config with webpki roots
            let root_store = rustls::RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            };

            let config = rustls::ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();

            let connector = TlsConnector::from(StdArc::new(config));

            let server_name = ServerName::try_from(host.clone())
                .map_err(|_| format!("Invalid DNS name: {}", host))?;

            let tls_stream = timeout(
                TLS_HANDSHAKE_TIMEOUT,
                connector.connect(server_name, tcp_stream),
            )
            .await
            .map_err(|_| {
                format!(
                    "TLS handshake timed out after {}s ({})",
                    TLS_HANDSHAKE_TIMEOUT.as_secs(),
                    host
                )
            })?
            .map_err(|e| format!("TLS handshake failed: {}", e))?;

            // Split the TLS stream using tokio::io::split
            let (reader, writer) = tokio::io::split(tls_stream);

            // Spawn read task
            let client_id_read = client_id.clone();
            let app_handle_read = app_handle.clone();
            let state_clone = state.0.clone();
            task::spawn(async move {
                read_task(client_id_read, reader, app_handle_read, state_clone).await;
            });

            // Spawn write task
            task::spawn(async move {
                write_task(writer, write_rx, shutdown_rx).await;
            });
        }
    } else {
        // Plain TCP - use into_split for owned halves
        let (reader, writer) = tcp_stream.into_split();

        // Spawn read task
        let client_id_read = client_id.clone();
        let app_handle_read = app_handle.clone();
        let state_clone = state.0.clone();
        task::spawn(async move {
            read_task(client_id_read, reader, app_handle_read, state_clone).await;
        });

        // Spawn write task
        task::spawn(async move {
            write_task(writer, write_rx, shutdown_rx).await;
        });
    }

    // Store the connection handle
    let mut connections = state.0.lock().await;
    connections.insert(client_id.clone(), ConnectionHandle {
        write_tx,
        shutdown_tx: Some(shutdown_tx),
    });

    // Emit connected event
    let _ = app_handle.emit("tcp-message", ReceivedPayload {
        id: client_id,
        event: MessageEvent {
            message: None,
            error: None,
            connected: Some(true),
        },
    });

    Ok(())
}

/// Parse address string to extract protocol, host, and port
fn parse_address(address: &str) -> Result<(bool, String, u16), String> {
    if let Some(stripped) = address.strip_prefix("ircs://") {
        let (host, port) = parse_host_port(stripped, 6697)?;
        Ok((true, host, port))
    } else if let Some(stripped) = address.strip_prefix("irc://") {
        let (host, port) = parse_host_port(stripped, 6667)?;
        Ok((false, host, port))
    } else {
        // Assume plain IRC if no protocol specified
        let (host, port) = parse_host_port(address, 6667)?;
        Ok((false, host, port))
    }
}

/// Parse host:port string with default port fallback
fn parse_host_port(host_port: &str, default_port: u16) -> Result<(String, u16), String> {
    if let Some((host, port_str)) = host_port.rsplit_once(':') {
        // Check if this is actually a valid port number
        if let Ok(port) = port_str.parse::<u16>() {
            Ok((host.to_string(), port))
        } else {
            // If port parsing fails, treat the whole thing as hostname
            Ok((host_port.to_string(), default_port))
        }
    } else {
        Ok((host_port.to_string(), default_port))
    }
}

/// Disconnect a specific client connection
#[tauri::command]
pub async fn disconnect(client_id: String, state: State<'_, SocketState>) -> Result<(), String> {
    let mut connections = state.0.lock().await;
    if let Some(mut handle) = connections.remove(&client_id) {
        // Send shutdown signal if available
        if let Some(shutdown_tx) = handle.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
        Ok(())
    } else {
        Err(format!("No connection found for client_id: {}", client_id))
    }
}

/// Start listening for messages from all active connections
#[tauri::command]
pub async fn listen(
    _state: State<'_, SocketState>,
    _app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // This is a placeholder - actual listening is handled by the read tasks
    // spawned during connection
    Ok(())
}

/// Send data to a specific client connection
#[tauri::command]
pub async fn send(
    client_id: String,
    data: String,
    state: State<'_, SocketState>,
) -> Result<(), String> {
    // Extract write_tx without holding the mutex across .await
    let write_tx = {
        let connections = state.0.lock().await;
        connections
            .get(&client_id)
            .map(|handle| handle.write_tx.clone())
    };

    if let Some(write_tx) = write_tx {
        write_tx
            .send(data)
            .await
            .map_err(|e| format!("Failed to send data: {}", e))?;
        Ok(())
    } else {
        Err(format!("No connection found for client_id: {}", client_id))
    }
}
