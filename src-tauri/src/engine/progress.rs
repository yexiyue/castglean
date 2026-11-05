//! Bounded-rate progress: drain producer updates, retain per-file high watermarks,
//! and flush the newest aggregate on EOF. No detached forwarding task.
use std::{collections::HashMap, time::Duration};
use talechime::Event;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy)]
pub(crate) struct DownloadMetrics {
    pub downloaded: u64,
    pub bytes_per_second: Option<f64>,
    pub stalled: bool,
}

/// Five-second byte-progress window, with one-second warm-up and idle expiry.
struct RateEstimator {
    samples: std::collections::VecDeque<(Duration, u64)>,
    origin: Option<Duration>,
    last_bytes: u64,
    last_change: Duration,
}
impl RateEstimator {
    fn new() -> Self {
        Self {
            samples: [(Duration::ZERO, 0)].into(),
            origin: None,
            last_bytes: 0,
            last_change: Duration::ZERO,
        }
    }
    fn sample(&mut self, now: Duration, downloaded: u64) -> DownloadMetrics {
        let now = now.saturating_sub(*self.origin.get_or_insert(now));
        let downloaded = downloaded.max(self.last_bytes);
        if downloaded > self.last_bytes {
            self.last_change = now;
            self.last_bytes = downloaded;
        }
        self.samples.push_back((now, downloaded));
        let cutoff = now.saturating_sub(Duration::from_secs(5));
        while self.samples.len() > 2 && self.samples[1].0 <= cutoff {
            self.samples.pop_front();
        }
        let stalled = now.saturating_sub(self.last_change) >= Duration::from_secs(5);
        let (time, bytes) = self.samples[0];
        let elapsed = now.saturating_sub(time.max(cutoff)).as_secs_f64();
        let bytes_per_second = if downloaded == 0 || now < Duration::from_secs(1) || elapsed <= 0.0
        {
            None
        } else if stalled {
            Some(0.0)
        } else {
            Some((downloaded - bytes) as f64 / elapsed)
        };
        DownloadMetrics {
            downloaded,
            bytes_per_second,
            stalled,
        }
    }
}

pub(crate) async fn forward(
    mut rx: mpsc::Receiver<Event>,
    mut publish: impl FnMut(&str, DownloadMetrics),
) {
    let mut files = HashMap::<String, (u64, u64)>::new();
    let mut current = None;
    let mut dirty = false;
    let started = std::time::Instant::now();
    let mut last_publish = Duration::ZERO;
    let mut estimator = RateEstimator::new();
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            event = rx.recv() => match event {
                Some(Event::ModelProgress { resource, downloaded, .. }) => {
                    files.entry(resource.clone()).and_modify(|(seen, _)| *seen = (*seen).max(downloaded)).or_insert((downloaded, downloaded));
                    let overall = files.values().map(|(high, _)| *high).sum::<u64>();
                    let transferred = files.values().map(|(high, initial)| high - initial).sum::<u64>();
                    current = Some((resource, overall, transferred));
                    dirty = true;
                }
                Some(_) => {}
                None => { if let Some((resource, overall, transferred)) = current.take() { let mut metrics = estimator.sample(started.elapsed(), transferred); metrics.downloaded = overall; publish(&resource, metrics); } break; }
            },
            _ = tick.tick() => if let Some((resource, overall, transferred)) = &current {
                let now = started.elapsed();
                let mut metrics = estimator.sample(now, *transferred);
                metrics.downloaded = *overall;
                if dirty || now.saturating_sub(last_publish) >= Duration::from_secs(1) {
                    publish(resource, metrics);
                    dirty = false;
                    last_publish = now;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn speed_warms_up_smooths_and_expires_without_new_bytes() {
        let mut rate = RateEstimator::new();
        rate.sample(Duration::ZERO, 0);
        assert!(
            rate.sample(Duration::from_millis(100), 100)
                .bytes_per_second
                .is_none()
        );
        assert_eq!(
            rate.sample(Duration::from_secs(1), 1000).bytes_per_second,
            Some(1000.0)
        );
        assert_eq!(
            rate.sample(Duration::from_secs(2), 2000).bytes_per_second,
            Some(1000.0)
        );
        let stalled = rate.sample(Duration::from_secs(7), 2000);
        assert!(stalled.stalled);
        assert_eq!(stalled.bytes_per_second, Some(0.0));
        let resumed = rate.sample(Duration::from_secs(8), 3000);
        assert!(!resumed.stalled);
        assert!(resumed.bytes_per_second.unwrap() > 0.0);
    }
    #[test]
    fn waiting_and_duplicate_samples_do_not_create_speed_or_regress_bytes() {
        let mut rate = RateEstimator::new();
        rate.sample(Duration::ZERO, 0);
        let waiting = rate.sample(Duration::from_secs(10), 0);
        assert!(waiting.stalled);
        assert!(waiting.bytes_per_second.is_none());
        rate.sample(Duration::from_secs(11), 100);
        let duplicate = rate.sample(Duration::from_secs(11), 90);
        assert_eq!(duplicate.downloaded, 100);
        assert!(duplicate.bytes_per_second.unwrap().is_finite());
    }
    #[test]
    fn network_setup_time_is_excluded_from_rate_warmup() {
        let mut rate = RateEstimator::new();
        assert!(
            rate.sample(Duration::from_secs(20), 0)
                .bytes_per_second
                .is_none()
        );
        assert_eq!(
            rate.sample(Duration::from_secs(21), 1000).bytes_per_second,
            Some(1000.0)
        );
    }
    #[tokio::test]
    async fn burst_is_coalesced_and_eof_flushes_without_waiting_for_next_tick() {
        let (tx, rx) = mpsc::channel(64);
        let produce = async move {
            for downloaded in 1..=1000 {
                tx.send(Event::ModelProgress {
                    resource: "weights".into(),
                    downloaded,
                    total: 1000,
                })
                .await
                .unwrap();
            }
        };
        let mut values = Vec::new();
        let start = std::time::Instant::now();
        tokio::join!(
            produce,
            forward(rx, |_, value| values.push(value.downloaded))
        );
        assert_eq!(values.last(), Some(&1000));
        assert!(values.windows(2).all(|w| w[0] <= w[1]));
        assert!(values.len() <= 2 + (start.elapsed().as_millis() / 100) as usize);
    }
    #[tokio::test]
    async fn live_updates_arrive_before_eof_and_multiple_files_never_regress() {
        let (tx, rx) = mpsc::channel(4);
        let (observed, acknowledged) = tokio::sync::oneshot::channel();
        let produce = async move {
            for (resource, downloaded) in [("a", 40), ("a", 20), ("b", 10)] {
                tx.send(Event::ModelProgress {
                    resource: resource.into(),
                    downloaded,
                    total: 100,
                })
                .await
                .unwrap();
            }
            tokio::time::timeout(Duration::from_secs(2), acknowledged)
                .await
                .unwrap()
                .unwrap();
            tx.send(Event::ModelProgress {
                resource: "b".into(),
                downloaded: 20,
                total: 100,
            })
            .await
            .unwrap();
        };
        let mut values = Vec::new();
        let mut observed = Some(observed);
        tokio::join!(
            produce,
            forward(rx, |_, value| {
                values.push(value.downloaded);
                if value.downloaded == 50
                    && let Some(sender) = observed.take()
                {
                    let _ = sender.send(());
                }
            })
        );
        assert!(values.contains(&50));
        assert_eq!(values.last(), Some(&60));
    }
}
