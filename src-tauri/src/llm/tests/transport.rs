use rig_core::http_client::{Bytes, HttpClientExt, Request};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};

#[tokio::test]
async fn disconnected_local_service_requires_an_explicit_new_request_after_recovery() {
    let reserved = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = reserved.local_addr().unwrap();
    drop(reserved);
    let endpoint = format!("http://{address}");
    let http =
        super::super::transport::BoundedHttp::with_timeout(&endpoint, Duration::from_secs(2))
            .unwrap();
    let request = || {
        Request::builder()
            .uri(&endpoint)
            .body(Bytes::new())
            .unwrap()
    };
    assert!(http.send_streaming(request()).await.is_err());

    let listener = TcpListener::bind(address).unwrap();
    listener.set_nonblocking(true).unwrap();
    assert!(
        listener.accept().is_err(),
        "recovery alone must not send a request"
    );
    listener.set_nonblocking(false).unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 8192];
        assert!(socket.read(&mut request).unwrap() > 0);
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
            .unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            listener.accept().is_err(),
            "recovery must not initiate an extra request"
        );
    });
    let response = http.send_streaming(request()).await.unwrap();
    assert_eq!(response.status(), 200);
    server.join().unwrap();
}

#[tokio::test]
async fn request_deadline_is_enforced_without_retry() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 8192];
        assert!(socket.read(&mut request).unwrap() > 0);
        std::thread::sleep(Duration::from_millis(150));
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err(), "transport must not retry");
    });
    let http =
        super::super::transport::BoundedHttp::with_timeout(&endpoint, Duration::from_millis(40))
            .unwrap();
    let request = Request::builder()
        .uri(&endpoint)
        .body(Bytes::new())
        .unwrap();
    assert!(http.send_streaming(request).await.is_err());
    server.join().unwrap();
}

#[tokio::test]
async fn redirect_never_forwards_credentials_to_a_second_origin() {
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let location = format!("http://{}/capture", target.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 8192];
        assert!(socket.read(&mut request).unwrap() > 0);
        socket.write_all(format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).unwrap();
    });
    let http = super::super::transport::BoundedHttp::new(&endpoint).unwrap();
    let request = Request::builder()
        .uri(&endpoint)
        .header("Authorization", "Bearer synthetic-test-token")
        .body(Bytes::new())
        .unwrap();
    assert!(http.send_streaming(request).await.is_err());
    server.join().unwrap();
    assert!(target.accept().is_err());
}

#[tokio::test]
async fn oversized_declared_body_is_rejected_before_buffering() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 8192];
        assert!(socket.read(&mut request).unwrap() > 0);
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 67108865\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let http = super::super::transport::BoundedHttp::new(&endpoint).unwrap();
    assert!(
        http.send_streaming(
            Request::builder()
                .uri(&endpoint)
                .body(Bytes::new())
                .unwrap()
        )
        .await
        .is_err()
    );
    server.join().unwrap();
}
