FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/api /app/api
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/api"]
