# 1) Build the browser client (Vite + Phaser).
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# 2) Build the Rust game server. Dependencies are cached in their own layer.
FROM rust:1-slim-bookworm AS server
WORKDIR /app/server
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
# SQL migrations are embedded into the binary at compile time.
COPY server/migrations ./migrations
COPY server/src ./src
RUN touch src/main.rs && cargo build --release

# 3) Small runtime image: server binary + static client. Accounts and
# characters live in PostgreSQL (the `db` service in docker-compose.yml).
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=server /app/server/target/release/tiny-adventurers-server /app/tiny-adventurers-server
COPY --from=client /app/client/dist /app/public
ENV STATIC_DIR=/app/public \
    PORT=8080 \
    RUST_LOG=info
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD ["/bin/sh", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /health HTTP/1.0\r\n\r\n' >&3 && grep -q OK <&3"]
CMD ["/app/tiny-adventurers-server"]
