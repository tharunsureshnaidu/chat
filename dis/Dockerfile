FROM rust:latest as builder

RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:trixie-slim
WORKDIR /app
COPY --from=builder /app/target/release/dis .
CMD ["./dis"]
