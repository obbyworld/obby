//! The background message check the mobile apps run while Obby is closed: a
//! short IRC session per server that keeps history, the same notification rule
//! the app uses, and the notifications to post. It needs no webview or Tauri
//! runtime, since Android starts it in a fresh process.

mod irc;
mod text;

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use tokio::time::{Duration, Instant};

use irc::HistoryMessage;
use text::{addresses_name, chat_key, matches_mask, notification_id, strip_formatting, truncate};

const SESSION_TIMEOUT: Duration = Duration::from_secs(12);
const TOTAL_BUDGET: Duration = Duration::from_secs(25);
const BODY_LIMIT: usize = 200;
const REMEMBERED_MSGIDS: usize = 200;
const E2EE_BODY_MARKER: &str = "?obe2ee:";

/// What the app hands over while it runs: the servers that keep history and
/// how to word the notifications.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub servers: Vec<ServerConfig>,
    pub strings: Strings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub id: String,
    /// `irc://`, `ircs://`, `ws://` or `wss://` with host and port.
    pub address: String,
    pub nick: String,
    pub account: Option<String>,
    pub password: Option<String>,
    pub server_password: Option<String>,
    pub bouncer_netid: Option<String>,
    #[serde(default)]
    pub custom_mentions: Vec<String>,
    #[serde(default)]
    pub ignore_list: Vec<String>,
    /// When the app stopped watching this server live.
    pub since: i64,
}

/// Translated text, since the native side has no translation catalog.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Strings {
    /// `{sender}` and `{target}` are filled in.
    pub channel_title: String,
    pub encrypted_body: String,
}

/// What a check remembers for the next one.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct State {
    #[serde(default)]
    pub servers: BTreeMap<String, ServerState>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub since: i64,
    #[serde(default)]
    pub notified: Vec<String>,
}

/// A notification for the platform to post, shaped like the notification
/// plugin's options so a tap reaches the app the same way.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: i32,
    pub title: String,
    pub body: String,
    pub group: String,
    pub extra: NoticeTarget,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeTarget {
    pub server_id: String,
    pub target: String,
    pub time: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub msgid: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub notices: Vec<Notice>,
    pub state: State,
    pub errors: Vec<String>,
}

fn is_encrypted(text: &str) -> bool {
    text == E2EE_BODY_MARKER || text.starts_with("?OTR")
}

/// The ACTION text of a `/me`, or None for any other CTCP.
fn readable_text(text: &str, sender: &str) -> Option<String> {
    let Some(ctcp) = text.strip_prefix('\x01') else {
        return Some(text.to_string());
    };
    let ctcp = ctcp.trim_end_matches('\x01');
    ctcp.strip_prefix("ACTION ")
        .map(|action| format!("* {sender} {action}"))
}

/// The notifications for one server: one per chat with its newest message,
/// following the app's rule (private messages and mentions from others,
/// skipping ignored senders and what we already notified).
fn notices_for(
    server: &ServerConfig,
    own_nick: &str,
    messages: &[HistoryMessage],
    strings: &Strings,
    notified: &[String],
) -> (Vec<Notice>, Vec<String>) {
    let mut newest: HashMap<String, (&HistoryMessage, String)> = HashMap::new();
    let mut fresh_msgids = Vec::new();
    for message in messages {
        let sender = message.source.split('!').next().unwrap_or("");
        if sender.eq_ignore_ascii_case(own_nick) || sender.eq_ignore_ascii_case(&server.nick) {
            continue;
        }
        if message
            .msgid
            .as_ref()
            .is_some_and(|id| notified.contains(id))
        {
            continue;
        }
        if server
            .ignore_list
            .iter()
            .any(|mask| matches_mask(mask, &message.source))
        {
            continue;
        }
        let Some(text) = readable_text(&message.text, sender) else {
            continue;
        };
        let is_mention = message.is_private
            || addresses_name(&text, own_nick)
            || server
                .custom_mentions
                .iter()
                .any(|mention| addresses_name(&text, mention));
        if !is_mention {
            continue;
        }
        if let Some(id) = &message.msgid {
            fresh_msgids.push(id.clone());
        }
        let body = if is_encrypted(&message.text) {
            strings.encrypted_body.clone()
        } else {
            text
        };
        let key = chat_key(&server.id, &message.chat);
        let is_newer = newest
            .get(&key)
            .map_or(true, |(current, _)| message.time >= current.time);
        if is_newer {
            newest.insert(key, (message, body));
        }
    }
    let mut notices: Vec<Notice> = newest
        .into_values()
        .map(|(message, body)| {
            let sender = message.source.split('!').next().unwrap_or("");
            let title = if message.is_private {
                sender.to_string()
            } else {
                strings
                    .channel_title
                    .replace("{sender}", sender)
                    .replace("{target}", &message.chat)
            };
            Notice {
                id: notification_id(&server.id, &message.chat),
                title,
                body: truncate(strip_formatting(&body).trim(), BODY_LIMIT),
                group: chat_key(&server.id, &message.chat),
                extra: NoticeTarget {
                    server_id: server.id.clone(),
                    target: message.chat.clone(),
                    time: message.time,
                    msgid: message.msgid.clone(),
                },
            }
        })
        .collect();
    notices.sort_by_key(|notice| notice.extra.time);
    (notices, fresh_msgids)
}

/// Checks every server once and returns the notifications to post and the
/// state for the next check.
pub async fn check(config: Config, mut state: State, now: i64) -> Outcome {
    let started = Instant::now();
    let mut notices = Vec::new();
    let mut errors = Vec::new();
    for server in &config.servers {
        let remaining = TOTAL_BUDGET.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        let deadline = Instant::now() + SESSION_TIMEOUT.min(remaining);
        let remembered = state.servers.entry(server.id.clone()).or_default();
        let since = remembered.since.max(server.since);
        match irc::fetch_history(server, since, now, deadline).await {
            Ok(messages) => {
                let (found, msgids) = notices_for(
                    server,
                    &server.nick,
                    &messages,
                    &config.strings,
                    &remembered.notified,
                );
                notices.extend(found);
                remembered.since = now;
                remembered.notified.extend(msgids);
                let excess = remembered.notified.len().saturating_sub(REMEMBERED_MSGIDS);
                remembered.notified.drain(..excess);
            }
            Err(error) => errors.push(format!("{}: {error}", server.id)),
        }
    }
    let known: Vec<&str> = config.servers.iter().map(|s| s.id.as_str()).collect();
    state.servers.retain(|id, _| known.contains(&id.as_str()));
    Outcome {
        notices,
        state,
        errors,
    }
}

/// Runs a check from JSON and answers in JSON, for the native bridges.
pub fn check_json(config: &str, state: &str, now: i64) -> String {
    let outcome = match serde_json::from_str::<Config>(config) {
        Ok(config) => {
            let state = serde_json::from_str(state).unwrap_or_default();
            match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime.block_on(check(config, state, now)),
                Err(error) => Outcome {
                    notices: Vec::new(),
                    state: State::default(),
                    errors: vec![error.to_string()],
                },
            }
        }
        Err(error) => Outcome {
            notices: Vec::new(),
            state: State::default(),
            errors: vec![format!("bad config: {error}")],
        },
    };
    serde_json::to_string(&outcome).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_world_obby_notifications_BackgroundCheck_nativeCheck<'local>(
    mut env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
    config: jni::objects::JString<'local>,
    state: jni::objects::JString<'local>,
    now: jni::sys::jlong,
) -> jni::sys::jstring {
    let read = |env: &mut jni::JNIEnv<'local>, value: &jni::objects::JString<'local>| {
        env.get_string(value).map(String::from).unwrap_or_default()
    };
    let config = read(&mut env, &config);
    let state = read(&mut env, &state);
    let outcome = check_json(&config, &state, now);
    env.new_string(outcome)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `config` and `state` must be valid NUL-terminated strings. The caller frees
/// the result with `obby_background_free`.
#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn obby_background_check(
    config: *const std::ffi::c_char,
    state: *const std::ffi::c_char,
    now: i64,
) -> *mut std::ffi::c_char {
    let read = |value: *const std::ffi::c_char| {
        if value.is_null() {
            String::new()
        } else {
            std::ffi::CStr::from_ptr(value)
                .to_string_lossy()
                .into_owned()
        }
    };
    let outcome = check_json(&read(config), &read(state), now);
    std::ffi::CString::new(outcome)
        .map(std::ffi::CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `value` must come from `obby_background_check`.
#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn obby_background_free(value: *mut std::ffi::c_char) {
    if !value.is_null() {
        drop(std::ffi::CString::from_raw(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server() -> ServerConfig {
        ServerConfig {
            id: "s1".into(),
            address: "ircs://irc.example:6697".into(),
            nick: "max".into(),
            account: Some("max".into()),
            password: Some("secret".into()),
            server_password: None,
            bouncer_netid: None,
            custom_mentions: vec!["stream".into()],
            ignore_list: vec!["spam!*@*".into()],
            since: 0,
        }
    }

    fn strings() -> Strings {
        Strings {
            channel_title: "{sender} in {target}".into(),
            encrypted_body: "New encrypted message".into(),
        }
    }

    fn message(chat: &str, from: &str, text: &str, time: i64, private: bool) -> HistoryMessage {
        HistoryMessage {
            chat: chat.into(),
            source: format!("{from}!u@h"),
            text: text.into(),
            time,
            msgid: Some(format!("m{time}")),
            is_private: private,
        }
    }

    #[test]
    fn notifies_private_messages_and_mentions_once_per_chat() {
        let messages = vec![
            message("#dev", "alice", "max: look at this", 1, false),
            message("#dev", "alice", "max: and this", 2, false),
            message("#dev", "bob", "nothing for you", 3, false),
            message("bob", "bob", "hey there", 4, true),
        ];
        let (notices, msgids) = notices_for(&server(), "max", &messages, &strings(), &[]);
        assert_eq!(notices.len(), 2);
        assert_eq!(notices[0].title, "alice in #dev");
        assert_eq!(notices[0].body, "max: and this");
        assert_eq!(notices[1].title, "bob");
        assert_eq!(notices[1].id, notification_id("s1", "bob"));
        assert_eq!(msgids, vec!["m1", "m2", "m4"]);
    }

    #[test]
    fn skips_our_own_ignored_and_already_notified_messages() {
        let messages = vec![
            message("#dev", "max", "max: talking to myself", 1, false),
            message("#dev", "spam", "max: buy now", 2, false),
            message("#dev", "alice", "the stream is up", 3, false),
        ];
        let (notices, _) = notices_for(&server(), "max", &messages, &strings(), &["m3".into()]);
        assert!(notices.is_empty());
    }

    #[test]
    fn hides_encrypted_text_and_reads_actions() {
        let messages = vec![
            message("bob", "bob", "?OTR:AAQD", 1, true),
            message("#dev", "alice", "\x01ACTION waves at max\x01", 2, false),
            message("#dev", "carol", "\x01VERSION\x01", 3, false),
        ];
        let (notices, _) = notices_for(&server(), "max", &messages, &strings(), &[]);
        let bodies: Vec<&str> = notices.iter().map(|n| n.body.as_str()).collect();
        assert_eq!(
            bodies,
            vec!["New encrypted message", "* alice waves at max"]
        );
    }

    #[test]
    fn rejects_a_bad_config_with_an_error() {
        let outcome: serde_json::Value =
            serde_json::from_str(&check_json("not json", "", 0)).unwrap();
        assert_eq!(outcome["notices"].as_array().unwrap().len(), 0);
        assert!(outcome["errors"][0]
            .as_str()
            .unwrap()
            .starts_with("bad config"));
    }
}
