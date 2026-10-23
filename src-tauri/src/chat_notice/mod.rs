//! Notifications the native side posts while the app is closed, from web push
//! and from the history poll, following the same rule as live notifications.

#[cfg(any(target_os = "android", test))]
pub mod push;
pub mod text;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use text::{addresses_name, chat_key, is_ignored, notification_id, strip_formatting, truncate};

const BODY_LIMIT: usize = 200;
const E2EE_BODY_MARKER: &str = "?obe2ee:";

/// A PRIVMSG with the chat it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatMessage {
    pub chat: String,
    pub source: String,
    pub text: String,
    pub time: i64,
    pub msgid: Option<String>,
    pub is_private: bool,
}

impl ChatMessage {
    pub fn sender(&self) -> &str {
        self.source.split('!').next().unwrap_or("")
    }
}

/// Who the notifications are for on one server.
pub struct Recipient<'a> {
    pub server_id: &'a str,
    pub nick: &'a str,
    pub custom_mentions: &'a [String],
    pub ignore_list: &'a [String],
}

/// Translated text, since the native side has no translation catalog.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Strings {
    /// `{sender}` and `{target}` are filled in.
    pub channel_title: String,
    pub encrypted_body: String,
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

fn is_encrypted(text: &str) -> bool {
    text == E2EE_BODY_MARKER || text.starts_with("?OTR")
}

enum Spoken<'a> {
    Said(&'a str),
    Action(&'a str),
}

/// What the sender said, or None for a CTCP other than `/me`.
fn spoken(text: &str) -> Option<Spoken<'_>> {
    let Some(ctcp) = text.strip_prefix('\x01') else {
        return Some(Spoken::Said(text));
    };
    ctcp.trim_end_matches('\x01')
        .strip_prefix("ACTION ")
        .map(Spoken::Action)
}

/// The notifications for one server: one per chat with its newest message,
/// following the app's rule (private messages and mentions from others,
/// skipping ignored senders, what we already notified, and anything we
/// answered in that chat). Also returns the msgids it notified.
pub fn notices_for(
    recipient: &Recipient,
    own_nick: &str,
    messages: &[ChatMessage],
    strings: &Strings,
    notified: &[String],
) -> (Vec<Notice>, Vec<String>) {
    let is_ours = |message: &ChatMessage| {
        let sender = message.sender();
        sender.eq_ignore_ascii_case(own_nick) || sender.eq_ignore_ascii_case(recipient.nick)
    };
    let mut answered_at: HashMap<String, i64> = HashMap::new();
    for message in messages.iter().filter(|m| is_ours(m)) {
        let latest = answered_at.entry(message.chat.to_lowercase()).or_default();
        *latest = (*latest).max(message.time);
    }
    let mut newest: HashMap<String, (&ChatMessage, String)> = HashMap::new();
    let mut fresh_msgids = Vec::new();
    for message in messages {
        let sender = message.sender();
        if is_ours(message)
            || answered_at
                .get(&message.chat.to_lowercase())
                .is_some_and(|&at| message.time <= at)
        {
            continue;
        }
        if message
            .msgid
            .as_ref()
            .is_some_and(|id| notified.contains(id))
        {
            continue;
        }
        if is_ignored(recipient.ignore_list, &message.source) {
            continue;
        }
        let (said, text) = match spoken(&message.text) {
            Some(Spoken::Said(said)) => (said, said.to_string()),
            Some(Spoken::Action(action)) => (action, format!("* {sender} {action}")),
            None => continue,
        };
        let is_mention = message.is_private
            || addresses_name(said, own_nick)
            || recipient
                .custom_mentions
                .iter()
                .any(|mention| addresses_name(said, mention));
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
        let key = chat_key(recipient.server_id, &message.chat);
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
            let sender = message.sender();
            let title = if message.is_private {
                sender.to_string()
            } else {
                strings
                    .channel_title
                    .replace("{sender}", sender)
                    .replace("{target}", &message.chat)
            };
            Notice {
                id: notification_id(recipient.server_id, &message.chat),
                title,
                body: truncate(strip_formatting(&body).trim(), BODY_LIMIT),
                group: chat_key(recipient.server_id, &message.chat),
                extra: NoticeTarget {
                    server_id: recipient.server_id.to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    const MENTIONS: [&str; 1] = ["stream"];
    const IGNORED: [&str; 1] = ["spam!*@*"];

    fn notices(messages: &[ChatMessage], notified: &[String]) -> (Vec<Notice>, Vec<String>) {
        let mentions: Vec<String> = MENTIONS.iter().map(|m| m.to_string()).collect();
        let ignored: Vec<String> = IGNORED.iter().map(|m| m.to_string()).collect();
        let recipient = Recipient {
            server_id: "s1",
            nick: "max",
            custom_mentions: &mentions,
            ignore_list: &ignored,
        };
        notices_for(&recipient, "max", messages, &strings(), notified)
    }

    fn strings() -> Strings {
        Strings {
            channel_title: "{sender} in {target}".into(),
            encrypted_body: "New encrypted message".into(),
        }
    }

    fn message(chat: &str, from: &str, text: &str, time: i64, private: bool) -> ChatMessage {
        ChatMessage {
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
        let (notices, msgids) = notices(&messages, &[]);
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
        let (notices, _) = notices(&messages, &["m3".into()]);
        assert!(notices.is_empty());
    }

    #[test]
    fn skips_what_we_answered_on_another_session() {
        let messages = vec![
            message("bob", "bob", "are you there?", 1, true),
            message("bob", "max", "yes", 2, true),
            message("#dev", "alice", "max: ping", 3, false),
        ];
        let (notices, _) = notices(&messages, &[]);
        let targets: Vec<&str> = notices.iter().map(|n| n.extra.target.as_str()).collect();
        assert_eq!(targets, vec!["#dev"]);
    }

    #[test]
    fn hides_encrypted_text_and_reads_actions() {
        let messages = vec![
            message("bob", "bob", "?OTR:AAQD", 1, true),
            message("#dev", "alice", "\x01ACTION waves at max\x01", 2, false),
            message("#dev", "carol", "\x01VERSION\x01", 3, false),
        ];
        let (notices, _) = notices(&messages, &[]);
        let bodies: Vec<&str> = notices.iter().map(|n| n.body.as_str()).collect();
        assert_eq!(
            bodies,
            vec!["New encrypted message", "* alice waves at max"]
        );
    }
}
