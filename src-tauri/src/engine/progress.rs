//! Bounded-rate progress: drain producer updates, retain per-file high watermarks,
//! and flush the newest aggregate on EOF. No detached forwarding task.
use std::{collections::HashMap, time::Duration};
use talechime::Event;
use tokio::sync::mpsc;

pub(super) async fn forward(mut rx: mpsc::Receiver<Event>, mut publish: impl FnMut(&str, u64)) {
    let mut files = HashMap::<String, u64>::new();
    let mut latest = None;
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            event = rx.recv() => match event {
                Some(Event::ModelProgress { resource, downloaded, .. }) => {
                    files.entry(resource.clone()).and_modify(|seen| *seen = (*seen).max(downloaded)).or_insert(downloaded);
                    latest = Some((resource, files.values().sum::<u64>()));
                }
                Some(_) => {}
                None => { if let Some((resource, overall)) = latest.take() { publish(&resource, overall); } break; }
            },
            _ = tick.tick() => if let Some((resource, overall)) = latest.take() { publish(&resource, overall); }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        tokio::join!(produce, forward(rx, |_, value| values.push(value)));
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
                values.push(value);
                if value == 50
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
