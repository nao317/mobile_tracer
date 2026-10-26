FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/api ./cmd/tapyrus-check

FROM tapyrus/esplora-tapyrus:v0.5.8@sha256:d14579f126580388a23d3f05fd7b6214ac2b1a3dfb769704ee08d48bd71b0e0f AS esplora
COPY --from=build /out/tapyrus-check /usr/local/bin/tapyrus-check

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/api /app/api
COPY --from=build /out/tapyrus-check /app/tapyrus-check
USER 65532:65532
ENV PORT=8080 SHUTDOWN_TIMEOUT=10s
EXPOSE 8080
ENTRYPOINT ["/app/api"]
