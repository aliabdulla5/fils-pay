# Shared by both nginx servers (ops/nginx.conf): /v1 and the health probes go
# to the api, with excess load refused before it reaches Node.

location /v1/ {
    # ~40 in flight is where the api's half vCPU peaks (about 50 checkouts/s
    # at ~1 s p95); admitting more only lengthens every request's queue.
    limit_conn api_inflight 48;
    limit_conn_status 503;
    # 502/504 here mean the api is restarting (the restart policy brings it
    # back in seconds): answer like overload, a retryable 503, not a 502.
    error_page 502 503 504 = @overloaded;
    # Logging every refused request cost more CPU than refusing it. The api
    # still logs what it serves.
    limit_conn_log_level info;
    access_log off;

    proxy_pass http://api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
    client_max_body_size 10m;
}

location ~ ^/(healthz|readyz)$ {
    proxy_pass http://api;
}

location @overloaded {
    add_header Retry-After 1 always;
    default_type application/json;
    return 503 '{"error":"overloaded","message":"try again shortly"}';
}
