//! Asking a site's API again for something that hasn't changed, for free: each answer is
//! kept with its ETag and asked for again with If-None-Match. GitHub doesn't count a
//! "304 Not Modified" against its hourly limit (GitLab answers 304 too, where it keeps
//! ETags), so the pull request badges can be checked every minute.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{LazyLock, Mutex};

use reqwest::{RequestBuilder, StatusCode, header};

/// Answers kept, by who asked and what for. Cleared when it gets this big.
const MAX_ANSWERS: usize = 2000;

static ANSWERS: LazyLock<Mutex<HashMap<String, (String, String)>>> =
    LazyLock::new(Default::default);

/// An answer: its status, and its body (the one kept, when it hadn't changed).
pub(crate) struct Answer {
    pub status: StatusCode,
    pub body: String,
}

/// Who's asking for `url`: a token is only kept as a hash (answers differ between people).
pub(crate) fn key(url: &str, token: Option<&str>) -> String {
    let who = token.map(|token| {
        let mut hasher = DefaultHasher::new();
        token.hash(&mut hasher);
        hasher.finish()
    });
    format!("{who:?}\n{url}")
}

/// Send `request` (for what `key` names), with the ETag of the answer kept for it, if any.
/// An unchanged answer comes back as that kept one, with a 200.
pub(crate) async fn send(key: &str, request: RequestBuilder) -> reqwest::Result<Answer> {
    let kept = ANSWERS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .cloned();
    let request = match &kept {
        Some((etag, _)) => request.header(header::IF_NONE_MATCH, etag),
        None => request,
    };
    let response = request.send().await?;
    let status = response.status();
    if status == StatusCode::NOT_MODIFIED
        && let Some((_, body)) = kept
    {
        return Ok(Answer {
            status: StatusCode::OK,
            body,
        });
    }
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response.text().await?;
    if status.is_success()
        && let Some(etag) = etag
    {
        let mut answers = ANSWERS.lock().unwrap_or_else(|e| e.into_inner());
        if answers.len() >= MAX_ANSWERS {
            answers.clear();
        }
        answers.insert(key.to_owned(), (etag, body.clone()));
    }
    Ok(Answer { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    /// A server that answers with an ETag, then "304" when asked with it.
    fn server() -> (String, std::thread::JoinHandle<Vec<Option<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/pulls", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut asked_with = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut etag = None;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line.trim().is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("if-none-match:") {
                        etag = Some(value.trim().to_owned());
                    }
                }
                let reply = if etag.as_deref() == Some("\"v1\"") {
                    "HTTP/1.1 304 Not Modified\r\nETag: \"v1\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned()
                } else {
                    "HTTP/1.1 200 OK\r\nETag: \"v1\"\r\nContent-Length: 7\r\nConnection: close\r\n\r\n[1,2,3]".to_owned()
                };
                stream.write_all(reply.as_bytes()).unwrap();
                asked_with.push(etag);
            }
            asked_with
        });
        (address, handle)
    }

    #[test]
    fn asks_again_with_the_etag_and_keeps_the_answer() {
        let (url, server) = server();
        let client = crate::github::client().unwrap();
        let key = key(&url, Some("a token"));
        let (first, second) = tauri::async_runtime::block_on(async {
            let first = send(&key, client.get(&url)).await.unwrap();
            let second = send(&key, client.get(&url)).await.unwrap();
            (first, second)
        });
        assert_eq!(
            (first.status, first.body.as_str()),
            (StatusCode::OK, "[1,2,3]")
        );
        // Unchanged: "304" from the server, the kept answer here.
        assert_eq!(
            (second.status, second.body.as_str()),
            (StatusCode::OK, "[1,2,3]")
        );
        assert_eq!(
            server.join().unwrap(),
            vec![None, Some("\"v1\"".to_owned())]
        );
    }

    #[test]
    fn keeps_answers_apart_by_who_asked() {
        assert_ne!(
            key("https://x/pulls", Some("one")),
            key("https://x/pulls", Some("two"))
        );
        assert_ne!(
            key("https://x/pulls", None),
            key("https://x/pulls", Some("one"))
        );
        assert!(!key("https://x/pulls", Some("secret")).contains("secret"));
    }
}
