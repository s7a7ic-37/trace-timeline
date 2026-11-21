const start = 1_795_269_600_000_000_000n;
const traceId = "f610421fa3b74ca4a6edee0213648a91";
const spanId = (id: number) => id.toString(16).padStart(16, "0");
const nanos = (ms: number) => String(start + BigInt(ms) * 1_000_000n);

function span(id: number, name: string, from: number, to: number, parent?: number, failed = false) {
  return {
    traceId, spanId: spanId(id), parentSpanId: parent ? spanId(parent) : "", name,
    startTimeUnixNano: nanos(from), endTimeUnixNano: nanos(to), status: { code: failed ? 2 : 1 },
  };
}

function service(name: string, spans: ReturnType<typeof span>[]) {
  return {
    resource: { attributes: [{ key: "service.name", value: { stringValue: name } }] },
    scopeSpans: [{ scope: { name: "example" }, spans }],
  };
}

export const example = {
  resourceSpans: [
    service("booking-gateway", [span(1, "POST /reservations", 0, 640), span(2, "Validate request", 14, 31, 1)]),
    service("schedule-service", [span(3, "Find available slot", 42, 250, 1), span(4, "Read bay schedule", 57, 215, 3), span(5, "Save reservation", 275, 513, 1)]),
    service("message-service", [span(6, "Queue confirmation", 530, 616, 1), span(7, "Send email", 549, 607, 6, true)]),
  ],
};
