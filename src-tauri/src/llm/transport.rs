//! A bounded HTTP transport for text LLM requests. No redirects or multipart operations.
use futures_util::StreamExt;
use rig_core::http_client::{
    self, Bytes, HttpClientExt, LazyBody, MultipartForm, Request, Response, StreamingResponse,
};
use rig_reqwest::reqwest;
use std::time::Duration;

pub(crate) type RequestAccounting =
    std::sync::Arc<dyn Fn(usize) -> Result<(), super::LlmError> + Send + Sync>;

#[derive(Clone)]
pub(crate) struct BoundedHttp {
    client: reqwest::Client,
    account: Option<RequestAccounting>,
    listing: Option<std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>>,
}
impl BoundedHttp {
    pub fn capture_listing(
        mut self,
        target: std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
    ) -> Self {
        self.listing = Some(target);
        self
    }
    pub fn with_account(mut self, account: RequestAccounting) -> Self {
        self.account = Some(account);
        self
    }
    pub fn new(endpoint: &str) -> Result<Self, super::LlmError> {
        Self::build(endpoint, Duration::from_secs(120))
    }
    pub(super) fn for_run(endpoint: &str) -> Result<Self, super::LlmError> {
        Self::build(endpoint, Duration::from_secs(600))
    }
    #[cfg(test)]
    pub(super) fn with_timeout(endpoint: &str, timeout: Duration) -> Result<Self, super::LlmError> {
        Self::build(endpoint, timeout)
    }
    fn build(endpoint: &str, timeout: Duration) -> Result<Self, super::LlmError> {
        let endpoint =
            url::Url::parse(endpoint).map_err(|_| super::LlmError::InvalidConfiguration)?;
        let loopback = match endpoint.host() {
            Some(url::Host::Domain("localhost")) => true,
            Some(url::Host::Ipv4(address)) => address.is_loopback(),
            Some(url::Host::Ipv6(address)) => address.is_loopback(),
            _ => false,
        };
        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(timeout);
        // Local services must stay local even when a system proxy is enabled.
        if loopback {
            builder = builder.no_proxy();
        }
        builder
            .build()
            .map(|client| Self {
                client,
                account: None,
                listing: None,
            })
            .map_err(|_| super::LlmError::Network)
    }
}
fn rejected() -> http_client::Error {
    http_client::Error::instance(std::io::Error::other("llm_transport_limit"))
}
impl HttpClientExt for BoundedHttp {
    fn send<T, U>(
        &self,
        req: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        let this = self.clone();
        let listing = self.listing.clone();
        let req = req.map(Into::<Bytes>::into);
        async move {
            let response = this.send_streaming(req).await?;
            let (parts, mut stream) = response.into_parts();
            let body: LazyBody<U> = Box::pin(async move {
                let mut bytes = Vec::new();
                while let Some(chunk) = stream.next().await {
                    bytes.extend_from_slice(&chunk?);
                }
                if let Some(listing) = listing
                    && let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes)
                    && let Ok(mut target) = listing.lock()
                    && let Some(entries) = value.get("data").and_then(|v| v.as_array())
                {
                    let used: usize = target
                        .iter()
                        .filter_map(|page| page.get("data")?.as_array())
                        .map(Vec::len)
                        .sum();
                    let data: Vec<_> = entries
                        .iter()
                        .filter_map(|entry| {
                            let id = entry.get("id")?.as_str()?;
                            let levels = entry.get("reasoning_levels")?.as_array()?;
                            if id.len() > 1024 {
                                return None;
                            }
                            let levels: Vec<_> = levels
                                .iter()
                                .filter_map(|level| level.as_str())
                                .filter(|level| {
                                    matches!(
                                        *level,
                                        "none"
                                            | "minimal"
                                            | "low"
                                            | "medium"
                                            | "high"
                                            | "xhigh"
                                            | "max"
                                            | "ultra"
                                    )
                                })
                                .take(16)
                                .collect();
                            Some(serde_json::json!({"id": id, "reasoning_levels": levels}))
                        })
                        .take(4096usize.saturating_sub(used))
                        .collect();
                    if !data.is_empty() {
                        target.push(serde_json::json!({"data": data}));
                    }
                }
                #[cfg(test)]
                super::test_support::public_diagnostic("http-response", &bytes);
                Ok(U::from(Bytes::from(bytes)))
            });
            Ok(Response::from_parts(parts, body))
        }
    }
    #[expect(
        clippy::manual_async_fn,
        reason = "HttpClientExt requires an owned static future independent of the borrowed client"
    )]
    fn send_multipart<U>(
        &self,
        _: Request<MultipartForm>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        async { Err(rejected()) }
    }
    fn send_streaming<T>(
        &self,
        req: Request<T>,
    ) -> impl Future<Output = http_client::Result<StreamingResponse>> + Send
    where
        T: Into<Bytes> + Send,
    {
        let client = self.client.clone();
        let account = self.account.clone();
        let (parts, body) = req.into_parts();
        let bytes: Bytes = body.into();
        async move {
            if bytes.len() > 64 * 1024 * 1024 {
                return Err(rejected());
            }
            if let Some(account) = account {
                let count = bytes.len();
                tokio::task::spawn_blocking(move || account(count))
                    .await
                    .map_err(|_| rejected())?
                    .map_err(|_| rejected())?;
            }
            let request = client
                .request(parts.method, parts.uri.to_string())
                .headers(parts.headers)
                .body(bytes)
                .build()
                .map_err(http_client::Error::instance)?;
            let started = std::time::Instant::now();
            let response = client
                .execute(request)
                .await
                .map_err(http_client::Error::instance)?;
            let status = response.status();
            // 只记状态码与主机名；请求体可能含正文或密钥，永不落日志。
            tracing::debug!(
                target: "perf",
                event = "llm_first_byte",
                host = parts.uri.host().unwrap_or_default(),
                status = status.as_u16(),
                duration_ms = started.elapsed().as_millis() as u64,
            );
            let headers = response.headers().clone();
            if !status.is_success() {
                // Keep only status metadata. Provider error bodies may contain keys or book text.
                tracing::warn!(
                    event = "llm_request_failed",
                    host = parts.uri.host().unwrap_or_default(),
                    status = status.as_u16(),
                );
                return Err(http_client::Error::non_success_with_details(
                    status,
                    headers,
                    String::new(),
                ));
            }
            if response
                .content_length()
                .is_some_and(|n| n > 64 * 1024 * 1024)
            {
                return Err(rejected());
            }
            let body = response.bytes_stream().scan(0usize, |size, chunk| {
                let chunk = match chunk {
                    Ok(bytes) => {
                        *size = size.saturating_add(bytes.len());
                        if *size > 64 * 1024 * 1024 {
                            Err(rejected())
                        } else {
                            Ok(bytes)
                        }
                    }
                    Err(error) => Err(http_client::Error::instance(error)),
                };
                std::future::ready(Some(chunk))
            });
            let mut result = Response::new(Box::pin(body) as http_client::BoxedStream);
            *result.status_mut() = status;
            *result.headers_mut() = headers;
            Ok(result)
        }
    }
}
