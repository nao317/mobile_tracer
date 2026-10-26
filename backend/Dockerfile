FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/api /app/api
USER 65532:65532
ENV PORT=8080 SHUTDOWN_TIMEOUT=10s
EXPOSE 8080
ENTRYPOINT ["/app/api"]
