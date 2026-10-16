//! Web push (draft/webpush, soju.im/webpush): the server sends one IRC
//! message per push, which the app turns into a notification while closed.

use serde::{Deserialize, Serialize};

use super::text::{notification_id, parse_iso_time, parse_line};
use super::{notices_for, ChatMessage, Notice, Recipient, Strings};

/// What the app saved for one server when it registered for push.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushContext {
    pub server_id: String,
    pub nick: String,
    pub chantypes: String,
    #[serde(default)]
    pub custom_mentions: Vec<String>,
    #[serde(default)]
    pub ignore_list: Vec<String>,
    #[serde(flatten)]
    pub strings: Strings,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushOutcome {
    pub notices: Vec<Notice>,
    /// The notification of a chat we answered from another client.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismiss: Option<i32>,
}

pub fn notice_for_push(context: &PushContext, raw: &str, now: i64) -> PushOutcome {
    let line = parse_line(raw);
    if line.command != "PRIVMSG" && line.command != "NOTICE" {
        return PushOutcome::default();
    }
    let sender = line.source.split('!').next().unwrap_or("");
    let target = line.param(0);
    if sender.is_empty() || target.is_empty() {
        return PushOutcome::default();
    }
    let is_private = !target
        .chars()
        .next()
        .is_some_and(|first| context.chantypes.contains(first));
    if sender.eq_ignore_ascii_case(&context.nick) {
        return PushOutcome {
            notices: Vec::new(),
            dismiss: Some(notification_id(&context.server_id, target)),
        };
    }
    let message = ChatMessage {
        chat: if is_private { sender } else { target }.to_string(),
        source: line.source.clone(),
        text: line.param(1).to_string(),
        time: line
            .tags
            .get("time")
            .and_then(|time| parse_iso_time(time))
            .unwrap_or(now),
        msgid: line.tags.get("msgid").cloned(),
        is_private,
    };
    let recipient = Recipient {
        server_id: &context.server_id,
        nick: &context.nick,
        custom_mentions: &context.custom_mentions,
        ignore_list: &context.ignore_list,
    };
    let (notices, _) = notices_for(&recipient, &context.nick, &[message], &context.strings, &[]);
    PushOutcome {
        notices,
        dismiss: None,
    }
}

/// Answers in JSON for the Android push service; a context we cannot read
/// posts nothing.
pub fn notice_for_push_json(context: &str, line: &str, now: i64) -> String {
    let outcome = serde_json::from_str::<PushContext>(context)
        .map(|context| notice_for_push(&context, line, now))
        .unwrap_or_default();
    serde_json::to_string(&outcome).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_world_obby_notifications_PushNative_nativeNotice<'local>(
    mut env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
    context: jni::objects::JString<'local>,
    line: jni::objects::JString<'local>,
    now: jni::sys::jlong,
) -> jni::sys::jstring {
    let read = |env: &mut jni::JNIEnv<'local>, value: &jni::objects::JString<'local>| {
        env.get_string(value).map(String::from).unwrap_or_default()
    };
    let context = read(&mut env, &context);
    let line = read(&mut env, &line);
    env.new_string(notice_for_push_json(&context, &line, now))
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> PushContext {
        serde_json::from_str(
            r##"{"serverId":"s1","nick":"max","chantypes":"#&","customMentions":["stream"],
                "ignoreList":["spam!*@*"],"channelTitle":"{sender} in {target}",
                "encryptedBody":"New encrypted message"}"##,
        )
        .unwrap()
    }

    #[test]
    fn notifies_a_private_message_with_its_msgid_and_time() {
        let outcome = notice_for_push(
            &context(),
            "@msgid=abc;time=2026-10-16T10:00:00.000Z :bob!b@h PRIVMSG max :hey there",
            1,
        );
        let notice = &outcome.notices[0];
        assert_eq!(notice.title, "bob");
        assert_eq!(notice.body, "hey there");
        assert_eq!(notice.id, notification_id("s1", "bob"));
        assert_eq!(notice.extra.target, "bob");
        assert_eq!(notice.extra.msgid.as_deref(), Some("abc"));
        assert_eq!(notice.extra.time, 1_792_144_800_000);
    }

    #[test]
    fn notifies_a_channel_mention_and_skips_other_channel_talk() {
        let mention = notice_for_push(&context(), ":alice!a@h PRIVMSG &ops :max: look", 7);
        assert_eq!(mention.notices[0].title, "alice in &ops");
        assert_eq!(mention.notices[0].extra.time, 7);
        let custom = notice_for_push(&context(), ":alice!a@h PRIVMSG #dev :the stream is up", 7);
        assert_eq!(custom.notices.len(), 1);
        let chatter = notice_for_push(&context(), ":alice!a@h PRIVMSG #dev :hello all", 7);
        assert!(chatter.notices.is_empty());
    }

    #[test]
    fn skips_ignored_senders_ctcp_and_other_commands() {
        for line in [
            ":spam!s@h PRIVMSG max :buy now",
            ":bob!b@h PRIVMSG max :\x01VERSION\x01",
            ":bob!b@h TAGMSG max",
            "garbage",
        ] {
            assert_eq!(
                notice_for_push(&context(), line, 0),
                PushOutcome::default(),
                "{line}"
            );
        }
    }

    #[test]
    fn dismisses_a_chat_we_answered_elsewhere() {
        let outcome = notice_for_push(&context(), ":Max!m@h PRIVMSG Bob :on it", 0);
        assert!(outcome.notices.is_empty());
        assert_eq!(outcome.dismiss, Some(notification_id("s1", "bob")));
    }

    #[test]
    fn posts_nothing_for_an_unreadable_context() {
        assert_eq!(
            notice_for_push_json("{}", ":bob!b@h PRIVMSG max :hi", 0),
            r#"{"notices":[]}"#
        );
    }
}
