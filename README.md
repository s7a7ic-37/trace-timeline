# Trace Timeline

Open an OpenTelemetry JSON trace and see when each operation started, how long it took and which service ran it. The fictional booking example includes one failed confirmation. Select a span to see its parent, duration and self time.

[Open the viewer](https://traces.artemislab.co.uk/)

The viewer reads OTLP JSON with `resourceSpans`, `scopeSpans` and `spans`. It supports up to 500 spans in a 512 KiB file. Nanosecond timestamps stay as integers until the viewer calculates relative positions. A partial trace can omit a parent span. Files stay in browser memory and are cleared when you leave the page.

Self time is the part of a span without recorded direct child work. Child intervals are clipped to the parent, and overlapping intervals count once. The result measures elapsed time, including waiting and any work absent from the trace.

## Run locally

Use Node 24 and Python 3.

    npm ci
    npm test
    npm run build
    python -m http.server 4203 --bind 127.0.0.1 --directory dist

Open http://127.0.0.1:4203. The dist directory needs only a static web host.

The tests include two fictional booking spans recorded by the OpenTelemetry JavaScript exporter on a local receiver.

[OpenTelemetry OTLP specification](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding)
