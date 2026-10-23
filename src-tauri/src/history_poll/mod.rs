//! History poll: the fallback for servers without web push. The mobile apps run
//! it while Obby is closed; Android starts it in a fresh process, so it depends
//! on tokio alone.

mod irc;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tokio::time::{Duration, Instant};

use crate::chat_notice::{notices_for, Notice, Recipient, Strings};

const SESSION_TIMEOUT: Duration = Duration::from_secs(12);
const TOTAL_BUDGET: Duration = Duration::from_secs(25);
const REMEMBERED_MSGIDS: usize = 200;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub notices: Vec<Notice>,
    pub state: State,
    pub errors: Vec<String>,
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
            Ok(history) => {
                let recipient = Recipient {
                    server_id: &server.id,
                    nick: &server.nick,
                    custom_mentions: &server.custom_mentions,
                    ignore_list: &server.ignore_list,
                };
                let (found, msgids) = notices_for(
                    &recipient,
                    &history.nick,
                    &history.messages,
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
pub extern "system" fn Java_world_obby_notifications_HistoryPollNative_nativeCheck<'local>(
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
/// the result with `obby_history_poll_free`.
#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn obby_history_poll_check(
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
/// `value` must come from `obby_history_poll_check`.
#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn obby_history_poll_free(value: *mut std::ffi::c_char) {
    if !value.is_null() {
        drop(std::ffi::CString::from_raw(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
