use std::collections::HashMap;

use chrono::{DateTime, SecondsFormat};

/// One IRC line split into its parts.
#[derive(Debug, Default, PartialEq)]
pub struct Line {
    pub tags: HashMap<String, String>,
    pub source: String,
    pub command: String,
    pub params: Vec<String>,
}

impl Line {
    pub fn param(&self, index: usize) -> &str {
        self.params.get(index).map(String::as_str).unwrap_or("")
    }
}

fn unescape_tag_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some(':') => out.push(';'),
            Some('s') => out.push(' '),
            Some('r') => out.push('\r'),
            Some('n') => out.push('\n'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

pub fn parse_line(raw: &str) -> Line {
    let mut rest = raw.trim_end_matches(['\r', '\n']);
    let mut line = Line::default();
    if let Some(tagged) = rest.strip_prefix('@') {
        let (tags, after) = tagged.split_once(' ').unwrap_or((tagged, ""));
        for tag in tags.split(';').filter(|t| !t.is_empty()) {
            let (key, value) = tag.split_once('=').unwrap_or((tag, ""));
            line.tags.insert(key.to_string(), unescape_tag_value(value));
        }
        rest = after.trim_start();
    }
    if let Some(sourced) = rest.strip_prefix(':') {
        let (source, after) = sourced.split_once(' ').unwrap_or((sourced, ""));
        line.source = source.to_string();
        rest = after.trim_start();
    }
    let (head, trailing) = match rest.split_once(" :") {
        Some((head, trailing)) => (head, Some(trailing)),
        None => (rest, None),
    };
    let mut words = head.split(' ').filter(|w| !w.is_empty());
    line.command = words.next().unwrap_or("").to_ascii_uppercase();
    line.params = words.map(str::to_string).collect();
    if let Some(trailing) = trailing {
        line.params.push(trailing.to_string());
    }
    line
}

/// A nick may be made of RFC 2812 nick characters plus the dash; a name is
/// only addressed when nothing on either side could be part of a longer name.
fn is_nick_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "[]\\`_^{}|-".contains(c)
}

pub fn addresses_name(content: &str, name: &str) -> bool {
    let needle: Vec<char> = name.trim().to_lowercase().chars().collect();
    if needle.is_empty() {
        return false;
    }
    let haystack: Vec<char> = content.to_lowercase().chars().collect();
    if haystack.len() < needle.len() {
        return false;
    }
    (0..=haystack.len() - needle.len()).any(|at| {
        haystack[at..at + needle.len()] == needle[..]
            && (at == 0 || !is_nick_char(haystack[at - 1]))
            && haystack
                .get(at + needle.len())
                .map_or(true, |&after| !is_nick_char(after))
    })
}

pub fn strip_formatting(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\x03' => {
                for _ in 0..2 {
                    if chars.peek().is_some_and(char::is_ascii_digit) {
                        chars.next();
                    }
                }
                if chars.peek() == Some(&',') {
                    chars.next();
                    for _ in 0..2 {
                        if chars.peek().is_some_and(char::is_ascii_digit) {
                            chars.next();
                        }
                    }
                }
            }
            '\x02' | '\x1d' | '\x1f' | '\x1e' | '\x16' | '\x11' | '\x0f' => {}
            _ => out.push(c),
        }
    }
    out
}

pub fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(limit - 1).collect();
    cut.push('…');
    cut
}

/// The same id the web app computes, so a chat keeps one notification whichever
/// side posted it: Java's String.hashCode over the UTF-16 units of the key.
pub fn notification_id(server_id: &str, target: &str) -> i32 {
    chat_key(server_id, target)
        .encode_utf16()
        .fold(0i32, |hash, unit| {
            hash.wrapping_mul(31).wrapping_add(unit as i32)
        })
}

pub fn chat_key(server_id: &str, target: &str) -> String {
    format!("{}:{}", server_id, target.to_lowercase())
}

pub fn iso_time(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn parse_iso_time(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.timestamp_millis())
}

/// Whether an ignore mask matches the sender, who may arrive as a bare nick.
pub fn is_ignored(masks: &[String], source: &str) -> bool {
    let hostmask = if source.contains('!') {
        source.to_string()
    } else {
        format!("{source}!*@*")
    };
    masks.iter().any(|mask| matches_mask(mask, &hostmask))
}

fn matches_mask(mask: &str, source: &str) -> bool {
    let mask: Vec<char> = mask.to_lowercase().chars().collect();
    let text: Vec<char> = source.to_lowercase().chars().collect();
    let (mut m, mut t) = (0, 0);
    let (mut star, mut star_t) = (None, 0);
    while t < text.len() {
        if m < mask.len() && (mask[m] == '?' || mask[m] == text[t]) {
            m += 1;
            t += 1;
        } else if m < mask.len() && mask[m] == '*' {
            star = Some(m);
            star_t = t;
            m += 1;
        } else if let Some(at) = star {
            m = at + 1;
            star_t += 1;
            t = star_t;
        } else {
            return false;
        }
    }
    mask[m..].iter().all(|&c| c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tags_source_and_trailing() {
        let line = parse_line(
            "@time=2026-10-15T09:30:00.123Z;msgid=abc :alice!a@h PRIVMSG #dev :hi there",
        );
        assert_eq!(line.tags["msgid"], "abc");
        assert_eq!(line.source, "alice!a@h");
        assert_eq!(line.command, "PRIVMSG");
        assert_eq!(line.params, vec!["#dev", "hi there"]);
        assert_eq!(parse_line("PING :x").params, vec!["x"]);
        assert_eq!(parse_line("@a=b\\sc :s CMD").tags["a"], "b c");
    }

    #[test]
    fn addresses_a_name_only_as_a_whole_word() {
        assert!(addresses_name("max: are you there", "max"));
        assert!(addresses_name("ping @Max!", "max"));
        assert!(!addresses_name("maximum effort", "max"));
        assert!(!addresses_name("", "max"));
    }

    #[test]
    fn strips_formatting_and_cuts_long_text() {
        assert_eq!(
            strip_formatting("\x0304,01red\x0f \x02bold\x02"),
            "red bold"
        );
        assert_eq!(truncate(&"x".repeat(300), 200).chars().count(), 200);
    }

    #[test]
    fn matches_the_web_notification_id() {
        // tests/lib/chatNotifications.test.ts pins the same values for the web side.
        assert_eq!(notification_id("s1", "#Dev"), 441242862);
        assert_eq!(notification_id("s1", "#\u{1F3AE}"), -953827591);
    }

    #[test]
    fn round_trips_server_time() {
        let ms = parse_iso_time("2026-10-15T09:30:00.123Z").unwrap();
        assert_eq!(iso_time(ms), "2026-10-15T09:30:00.123Z");
        assert_eq!(parse_iso_time("1970-01-01T00:00:00Z"), Some(0));
    }

    #[test]
    fn matches_ignore_masks() {
        assert!(matches_mask("HistServ!*@*", "histserv!h@services"));
        assert!(matches_mask("*!*@spam.example", "bob!b@spam.example"));
        assert!(!matches_mask("alice!*@*", "bob!b@h"));
        assert!(is_ignored(&["HistServ!*@*".into()], "HistServ"));
    }
}
