export const fileLimit = 512 * 1024;
export const spanLimit = 500;

export type Span = {
  id: string;
  parent: string | null;
  name: string;
  service: string;
  start: bigint;
  end: bigint;
  status: "Error" | "OK" | "Unset";
};

export type Trace = { id: string; spans: Span[]; start: bigint; end: bigint };

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

function spanArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Expected an OTLP ${field} array.`);
  return value;
}

function hexId(value: unknown, pattern: RegExp, field: string) {
  if (typeof value !== "string" || !pattern.test(value) || /^0+$/.test(value)) {
    throw new TypeError(`A span has an invalid ${field}.`);
  }
  return value.toLowerCase();
}

const traceId = /^[0-9a-f]{32}$/i;
const spanId = /^[0-9a-f]{16}$/i;

function nanos(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) {
    throw new TypeError("A span has an invalid nanosecond timestamp. Use a decimal string for large timestamps.");
  }
  const time = BigInt(value);
  if (time > 0xffffffffffffffffn) throw new RangeError("A span timestamp exceeds the OTLP range.");
  return time;
}

function serviceName(resourceGroup: Record<string, unknown>) {
  const attributes = record(resourceGroup.resource)?.attributes;
  const name = Array.isArray(attributes) && attributes.find(item => record(item)?.key === "service.name");
  const label = record(record(name)?.value)?.stringValue;
  return typeof label === "string" ? label.trim().slice(0, 100) || "Unknown service" : "Unknown service";
}

function checkParents(spans: Span[]) {
  const byId = new Map(spans.map(span => [span.id, span]));
  const checked = new Set<string>();
  for (const span of spans) {
    let current: Span | undefined = span;
    const path = new Set<string>();
    while (current && !checked.has(current.id)) {
      if (path.has(current.id)) throw new RangeError("A trace has a parent cycle.");
      path.add(current.id);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    for (const id of path) checked.add(id);
  }
}

export function parseTraces(payload: unknown): Trace[] {
  const groups = spanArray(record(payload)?.resourceSpans, "resourceSpans");
  const traces = new Map<string, Span[]>();
  let count = 0;
  for (const value of groups) {
    const group = record(value);
    if (!group) throw new TypeError("Expected an OTLP resource group.");
    const service = serviceName(group);
    for (const scope of spanArray(group.scopeSpans ?? [], "scopeSpans")) {
      for (const raw of spanArray(record(scope)?.spans ?? [], "spans")) {
        if (++count > spanLimit) throw new RangeError(`Open a trace file with at most ${spanLimit} spans.`);
        const source = record(raw);
        if (!source || typeof source.name !== "string" || !source.name.trim()) throw new TypeError("A span needs a name.");
        const trace = hexId(source.traceId, traceId, "trace ID");
        const id = hexId(source.spanId, spanId, "span ID");
        const parent = source.parentSpanId === undefined || source.parentSpanId === ""
          ? null : hexId(source.parentSpanId, spanId, "parent span ID");
        const start = nanos(source.startTimeUnixNano);
        const end = nanos(source.endTimeUnixNano);
        if (end < start) throw new RangeError("A span ends before it starts.");
        if (parent === id) throw new RangeError("A span cannot be its own parent.");

        const code = record(source.status)?.code;
        const status = code === 2 ? "Error" : code === 1 ? "OK" : "Unset";
        const spans = traces.get(trace) ?? [];
        if (spans.some(other => other.id === id)) throw new RangeError("A trace has duplicate span IDs.");
        spans.push({ id, parent, name: source.name.trim().slice(0, 160), service, start, end, status });
        if (!traces.has(trace)) traces.set(trace, spans);
      }
    }
  }
  if (!count) throw new TypeError("This trace file contains no spans.");
  return [...traces].map(([id, spans]) => {
    checkParents(spans);
    spans.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    const end = spans.reduce((latest, span) => span.end > latest ? span.end : latest, spans[0].end);
    return { id, spans, start: spans[0].start, end };
  });
}

export function readTraceText(text: string): Trace[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new TypeError("This file is not valid JSON.");
  }
  return parseTraces(payload);
}

export function selfTime(trace: Trace, span: Span): bigint {
  let uncovered = span.end - span.start;
  let coveredThrough = span.start;
  // Parsed spans are sorted by start, so only subtract newly covered time.
  for (const child of trace.spans) {
    if (child.start >= span.end) break;
    if (child.parent !== span.id) continue;
    const start = child.start > coveredThrough ? child.start : coveredThrough;
    const end = child.end < span.end ? child.end : span.end;
    if (start < end) {
      uncovered -= end - start;
      coveredThrough = end;
    }
  }
  return uncovered;
}

const milliseconds = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export function duration(ns: bigint) {
  if (ns > 0n && ns < 10_000n) return "<0.01 ms";
  return milliseconds.format(Number(ns) / 1_000_000) + " ms";
}
