import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { example } from "../dist/example.js";
import { duration, parseTraces, readTraceText, spanLimit } from "../dist/trace.js";

test("joins spans across resources in time order with exact nanosecond bounds", () => {
  const [trace] = parseTraces(example);
  assert.equal(trace.spans.length, 7);
  assert.equal(trace.end - trace.start, 640_000_000n);
  assert.equal(trace.spans[4].name, "Save reservation");
  assert.equal(trace.spans[6].status, "Error");
  assert.equal(trace.spans[6].parent, trace.spans[5].id);
  assert.equal(new Set(trace.spans.map(span => span.service)).size, 3);
});

function withSpans(spans) {
  return { resourceSpans: [{ scopeSpans: [{ spans }] }] };
}

const first = example.resourceSpans[0].scopeSpans[0].spans[0];

test("keeps distinct trace IDs separate and accepts a missing parent in a partial file", () => {
  const other = { ...first, traceId: "a".repeat(32), parentSpanId: "a".repeat(16) };
  const traces = parseTraces(withSpans([first, other]));
  assert.equal(traces.length, 2);
  assert.equal(traces[1].spans[0].parent, "a".repeat(16));
  assert.equal(traces[1].spans[0].service, "Unknown service");
});

test("rejects invalid, unsafe or reversed timestamps and duplicate spans", () => {
  assert.throws(() => parseTraces(withSpans([{ ...first, startTimeUnixNano: Number(first.startTimeUnixNano) }])), /nanosecond/);
  assert.throws(() => parseTraces(withSpans([{ ...first, endTimeUnixNano: "18446744073709551616" }])), /OTLP range/);
  assert.throws(() => parseTraces(withSpans([{ ...first, endTimeUnixNano: "0" }])), /ends before/);
  assert.throws(() => parseTraces(withSpans([first, first])), /duplicate/);
  assert.throws(() => parseTraces(withSpans([{ ...first, parentSpanId: first.spanId }])), /own parent/);
});

test("normalizes valid uppercase IDs and bounds the number of spans", () => {
  assert.equal(parseTraces(withSpans([{ ...first, traceId: first.traceId.toUpperCase() }]))[0].id, first.traceId);
  const large = Array.from({ length: spanLimit + 1 }, (_, index) => ({ ...first, spanId: (index + 1).toString(16).padStart(16, "0") }));
  assert.throws(() => parseTraces(withSpans(large)), /at most 500/);
});

test("reports malformed and empty trace files without printing their contents", () => {
  assert.throws(() => readTraceText('{'), /not valid JSON/);
  assert.throws(() => readTraceText('{}'), /resourceSpans/);
  assert.throws(() => parseTraces(withSpans([])), /no spans/);
  assert.equal(duration(12_500_000n), "12.5 ms");
  assert.equal(duration(42n), "<0.01 ms");
});

test("reads JSON emitted by the official OpenTelemetry JavaScript exporter", () => {
  const json = readFileSync(new URL("fixtures/sdk-export.json", import.meta.url), "utf8");
  const [trace] = readTraceText(json);
  const root = trace.spans.find(span => span.name === "Reserve sample bay");
  const child = trace.spans.find(span => span.name === "Send sample notification");
  assert.equal(trace.spans.length, 2);
  assert.equal(child.parent, root.id);
  assert.equal(child.status, "Error");
  assert.equal(child.service, "local-booking-fixture");
});
