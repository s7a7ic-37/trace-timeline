import { duration, fileLimit, parseTraces, readTraceText, selfTime, type Span, type Trace } from "./trace.js";
import { example } from "./example.js";

const element = (id: string) => document.getElementById(id)!;
const fileInput = element("trace-file") as HTMLInputElement;
const traceChoice = element("trace-choice") as HTMLSelectElement;
const filter = element("errors-only") as HTMLInputElement;
const list = element("span-list");
const viewDetails = element("view-details");
const backToSpan = element("back-to-span");
const fileStatus = element("file-status");
const sample = parseTraces(example);
let traces = sample;
let traceIndex = 0;
let selected: Span | undefined;
let readVersion = 0;

function note(text: string, error = false) {
  fileStatus.textContent = text;
  fileStatus.toggleAttribute("data-error", error);
}

function showDetail(trace: Trace) {
  element("detail-name").textContent = selected?.name ?? "Choose a span.";
  element("span-details").hidden = !selected;
  viewDetails.hidden = !selected;
  backToSpan.hidden = !selected;
  if (!selected) return;
  element("detail-service").textContent = selected.service;
  const status = element("detail-status");
  status.textContent = selected.status;
  status.toggleAttribute("data-error", selected.status === "Error");
  const parent = trace.spans.find(span => span.id === selected?.parent);
  element("detail-parent").textContent = parent?.name ?? selected.parent ?? "None";
  element("detail-start").textContent = duration(selected.start - trace.start);
  element("detail-end").textContent = duration(selected.end - trace.start);
  element("detail-duration").textContent = duration(selected.end - selected.start);
  element("detail-self-time").textContent = duration(selfTime(trace, selected));
}

function makeRow(trace: Trace, span: Span) {
  const row = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "span-row";
  button.setAttribute("aria-pressed", String(span === selected));
  button.setAttribute("aria-controls", "span-details");
  button.toggleAttribute("data-error", span.status === "Error");

  const label = document.createElement("span");
  label.className = "span-label";
  const name = document.createElement("strong");
  name.textContent = span.name;
  const description = document.createElement("small");
  description.textContent = span.service + (span.status === "Error" ? " · Error" : "");
  label.append(name, description);

  const lane = document.createElement("span");
  lane.className = "lane";
  lane.setAttribute("aria-hidden", "true");
  const bar = document.createElement("span");
  bar.className = "segment";
  const total = trace.end - trace.start;
  const percent = (ns: bigint) => total ? Number(ns * 10000n / total) / 100 : 0;
  const width = Math.max(.4, percent(span.end - span.start));
  bar.style.width = width + "%";
  bar.style.left = Math.min(percent(span.start - trace.start), 100 - width) + "%";
  lane.append(bar);

  const length = document.createElement("span");
  length.className = "number";
  length.textContent = duration(span.end - span.start);
  button.append(label, lane, length);
  button.addEventListener("click", () => {
    list.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-pressed", "true");
    selected = span;
    showDetail(trace);
  });
  row.append(button);
  return row;
}

function showTrace() {
  const trace = traces[traceIndex];
  const errors = trace.spans.filter(span => span.status === "Error");
  const visible = filter.checked ? errors : trace.spans;
  if (!selected || !visible.includes(selected)) selected = visible[0];
  const elapsed = duration(trace.end - trace.start);
  element("total-time").textContent = elapsed;
  element("time-end").textContent = elapsed;
  element("span-count").textContent = String(trace.spans.length);
  element("error-count").textContent = String(errors.length);
  list.replaceChildren(...visible.map(span => makeRow(trace, span)));
  element("empty-spans").hidden = visible.length !== 0;
  showDetail(trace);
}

function load(next: Trace[], name: string) {
  traces = next;
  traceIndex = 0;
  selected = undefined;
  filter.checked = false;
  element("dataset").textContent = name;
  element("trace-control").hidden = next.length === 1;
  traceChoice.replaceChildren(...next.map((trace, index) => new Option(
    (index + 1) + " · " + trace.id.slice(0, 8) + "…" + trace.id.slice(-4) +
    " · " + trace.spans.length + (trace.spans.length === 1 ? " span" : " spans"),
    String(index),
  )));
  showTrace();
}

function importError(summary: string) {
  note(summary + " The current trace is unchanged.", true);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  const version = ++readVersion;
  if (file.size > fileLimit) {
    importError("Choose a JSON file up to 512 KiB.");
    return;
  }
  note("Reading the trace file…");
  const bytes = await file.arrayBuffer().catch(() => null);
  if (version !== readVersion) return;
  if (!bytes) {
    importError("This file could not be read.");
    return;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    importError("This file must use UTF-8 encoding.");
    return;
  }
  try {
    const imported = readTraceText(text);
    load(imported, "Imported trace file");
    note(imported.length === 1 ? "Loaded one trace." : "Loaded " + imported.length + " traces.");
  } catch (failure) {
    importError(failure instanceof Error ? failure.message : "The trace file could not be opened.");
  }
});

element("load-example").addEventListener("click", () => {
  readVersion += 1;
  load(sample, "Fictional booking example");
  note("Booking example loaded.");
});

traceChoice.addEventListener("change", () => {
  traceIndex = Number(traceChoice.value);
  showTrace();
});

filter.addEventListener("change", showTrace);
viewDetails.addEventListener("click", () => {
  const heading = element("detail-heading");
  heading.focus({ preventScroll: true });
  heading.scrollIntoView({ block: "start" });
});
backToSpan.addEventListener("click", () => {
  const row = list.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: "center" });
});
load(sample, "Fictional booking example");
