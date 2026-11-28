import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { example } from "../dist/example.js";
import { duration, parseTraces, readTraceText, selfTime, spanLimit } from "../dist/trace.js";

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

function timedSpan(id, from, to, parent) {
  const hex = value => value.toString(16).padStart(16, "0");
  const timestamp = offset => String(BigInt(first.startTimeUnixNano) + BigInt(offset));
  return {
    ...first, spanId: hex(id), parentSpanId: parent ? hex(parent) : "",
    startTimeUnixNano: timestamp(from), endTimeUnixNano: timestamp(to),
  };
}

test("self time clips child intervals and counts overlapping time once", () => {
  const parent = timedSpan(1, 100, 200);
  const [trace] = parseTraces(withSpans([
    timedSpan(2, 186, 210, 1), parent,
    timedSpan(3, 124, 128, 1), timedSpan(4, 90, 130, 1), timedSpan(5, 201, 230, 1),
    timedSpan(6, 120, 150, 1), timedSpan(7, 150, 162, 1), timedSpan(8, 170, 188, 1),
    timedSpan(9, 0, 99, 1), timedSpan(10, 165, 165, 1),
  ]));
  assert.equal(selfTime(trace, trace.spans.find(span => span.id === parent.spanId)), 8n);
});

test("self time excludes direct children only, even if a grandchild extends beyond a child", () => {
  const parent = timedSpan(1, 10, 90);
  const child = timedSpan(2, 15, 35, 1);
  const [trace] = parseTraces(withSpans([parent, child, timedSpan(3, 60, 70, 2)]));
  assert.equal(selfTime(trace, trace.spans[0]), 60n);
  assert.equal(selfTime(trace, trace.spans[1]), 20n);
});

test("self time handles zero duration and spans with a missing parent", () => {
  const instant = timedSpan(1, 20, 20);
  const partial = timedSpan(3, 90, 100, 99);
  const [trace] = parseTraces(withSpans([instant, timedSpan(2, 10, 30, 1), partial, timedSpan(4, 95, 97, 3)]));
  const find = fixture => trace.spans.find(span => span.id === fixture.spanId);
  assert.equal(selfTime(trace, find(instant)), 0n);
  assert.equal(selfTime(trace, find(partial)), 8n);
  assert.equal(selfTime(trace, trace.spans.at(-1)), 2n);
});

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

test("rejects cycles even when the cyclic spans have a descendant listed first", () => {
  assert.throws(() => parseTraces(withSpans([
    timedSpan(4, 0, 100, 2), timedSpan(1, 1, 10, 3),
    timedSpan(2, 2, 9, 1), timedSpan(3, 3, 8, 2),
  ])), /parent cycle/);
});

test("a parent chain may end at a span outside the file", () => {
  const spans = Array.from({ length: spanLimit }, (_, index) => timedSpan(index + 1, index, index + 1, index + 2));
  const [trace] = parseTraces(withSpans(spans));
  assert.equal(trace.spans.length, spanLimit);
  assert.equal(trace.spans.at(-1).parent, spans.at(-1).parentSpanId);
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
  assert.equal(selfTime(trace, root), 383_300n);
});
