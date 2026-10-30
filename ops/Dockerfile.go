# Multi-stage build of apps/settlement (the `settlement` CLI / daemon).
FROM golang:1.22-bookworm AS build

WORKDIR /src
COPY apps/settlement/go.mod apps/settlement/go.sum ./
RUN go mod download
COPY apps/settlement/ ./
# timetzdata embeds the zone database: the business day is Asia/Bahrain
# (window.go) and the runtime image has no /usr/share/zoneinfo.
RUN CGO_ENABLED=0 go build -tags timetzdata -o /out/settlement ./cmd/settlement

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/settlement ./settlement
EXPOSE 8091
ENTRYPOINT []
CMD ["./settlement", "daemon"]
