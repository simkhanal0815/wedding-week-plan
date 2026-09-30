// Generates a single self-contained index.html from the canvas source files, so the
// site and the canvases never drift apart. Run: node site/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CANVAS_DIR = join(
  process.env.HOME,
  ".cursor/projects/Users-skhanal-Wedding-Planning/canvases",
);

const src = {
  schedule: readFileSync(join(CANVAS_DIR, "simran-and-prats-wedding-schedule.canvas.tsx"), "utf8"),
  packing: readFileSync(join(CANVAS_DIR, "whole-wedding-packing-list.canvas.tsx"), "utf8"),
  ceremony: readFileSync(join(CANVAS_DIR, "ceremony-packing-assignments.canvas.tsx"), "utf8"),
};

/** Pull `const NAME ... = <literal>;` out of a canvas file and evaluate it. */
function extract(source, name, helpers = {}) {
  const decl = new RegExp(`^const ${name}(?::[^=]+)? = `, "m");
  const m = decl.exec(source);
  if (!m) throw new Error(`Could not find const ${name}`);
  const i = m.index + m[0].length;
  const open = source[i];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = null;
  let end = -1;
  for (let j = i; j < source.length; j++) {
    const c = source[j];
    if (inStr) {
      if (c === "\\") j++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        end = j + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Unbalanced literal for ${name}`);
  const literal = source
    .slice(i, end)
    .replace(/ as const/g, "")
    .replace(/\/\/[^\n]*/g, "");
  const args = Object.keys(helpers);
  return new Function(...args, `return (${literal});`)(...args.map((k) => helpers[k]));
}

const tags = {};
for (const m of src.schedule.matchAll(/^const (\w+): Tag = "([^"]+)";/gm)) tags[m[1]] = m[2];

const t = (h, mm = 0) => h * 60 + mm;
const r = (start, end, what, source, who, expand) => ({ start, end, what, source, who, expand });
const tbd = (label, what, source, who) => ({ tbd: label, what, source, who });
const helpers = { t, r, tbd, ...tags };

const people = extract(src.schedule, "people");
const days = extract(src.schedule, "days", helpers);
const prePhotoRows = extract(src.schedule, "prePhotoRows", helpers);
const ceremonyRows = extract(src.schedule, "ceremonyRows", helpers);
const receptionRows = extract(src.schedule, "receptionRows", helpers);
const prePhotoBlocks = extract(src.schedule, "prePhotoBlocks", helpers);
const ceremonyBlocks = extract(src.schedule, "ceremonyBlocks", helpers);
const receptionBlocks = extract(src.schedule, "receptionBlocks", helpers);
const openItems = extract(src.schedule, "openItems", helpers);

const asks = JSON.parse(readFileSync(join(here, "asks.json"), "utf8"));

const packingEvents = extract(src.packing, "events");
const acrossEvents = extract(src.packing, "acrossEvents");

const closedByDecor = extract(src.ceremony, "closedByDecor");
const unowned = extract(src.ceremony, "unowned");
const columns = extract(src.ceremony, "columns");
const resortItems = extract(src.ceremony, "resortItems");
const settledRoles = extract(src.ceremony, "settledRoles");
const openRoles = extract(src.ceremony, "openRoles");
const bernardoSends = extract(src.ceremony, "bernardoSends");
const petalBrideSide = extract(src.ceremony, "petalBrideSide");
const petalGroomSide = extract(src.ceremony, "petalGroomSide");

// Mirrors the constants in the schedule canvas.
const TRACK_START = t(2);
const TRACK_END = t(25);
const WEEK_START = t(2);
const WEEK_END = t(25);
const HOUR_PX = 36;

const subRowsFor = { prephotos: prePhotoRows, ceremony: ceremonyRows, reception: receptionRows };

// ---------- formatting ----------
// The published page is on a public repo, so money never goes out. Anything that slips
// past these rules trips the assertion at the bottom of the build instead of shipping.
const scrub = (s) =>
  String(s)
    .replace(/ at \$[\d,]+(?:\.\d+)? each/g, "")
    .replace(/,? \$[\d,]+(?:\.\d+)? each/g, "")
    .replace(/,? \$[\d,]+(?:\.\d+)? under the/g, " under the")
    .replace(/ at \$[\d,]+(?:\.\d+)?/g, "")
    .replace(/^\$[\d,]+(?:\.\d+)? on the/g, "On the")
    .replace(/ a one-time \$[\d,]+(?:\.\d+)? fee/g, " a one-time fee")
    .replace(/ {2,}/g, " ")
    .replace(/ \./g, ".");

const esc = (s) =>
  scrub(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fmtClock(m) {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

function fmtHour(m) {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, "0")}`;
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m}`;
}

function rowTime(row) {
  if (row.tbd) return row.tbd;
  return `${fmtClock(row.start)} – ${fmtClock(row.end)} (${fmtDuration(row.end - row.start)})`;
}

const shortRange = (row) => `${fmtClock(row.start)} – ${fmtClock(row.end)}`;

const isEvent = (row) =>
  row.expand === "ceremony" ||
  row.expand === "reception" ||
  /^(Welcome Party|Sangeet & Mehndi|Baraat)/.test(row.what);

const isPhotoVideo = (row) =>
  !isEvent(row) &&
  /photo|shoot|first look|portrait|same-day edit|private vows|pictures/i.test(row.what) &&
  !/photo booth/i.test(row.what);

const weekKind = (row) => (isEvent(row) ? "event" : isPhotoVideo(row) ? "shoot" : "prep");
const isOption = (row) => row.tentative === true || /^(Possible|If )/.test(row.what);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- day track ----------
const sunIcon = (dir) =>
  `<svg class="sunicon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 13.5a3.5 3.5 0 0 1 7 0"/><path d="M1.5 13.5h13"/><path d="M8 2.8v4.4"/><path d="${
    dir === "up" ? "M6.1 4.7 8 2.8l1.9 1.9" : "M6.1 5.3 8 7.2l1.9-1.9"
  }"/></g></svg>`;

function dayTrack({ blocks, arrivals = [], sunriseMin, sunsetMin, start = TRACK_START, end = TRACK_END, tickStep = 120 }) {
  const span = end - start;
  const pct = (m) => `${((m - start) / span) * 100}%`;
  const ticks = [];
  for (let m = start; m <= end; m += tickStep) ticks.push(m);

  const marks = [];
  if (sunriseMin !== undefined) marks.push({ minutes: sunriseMin, dir: "up", label: "Sunrise" });
  if (sunsetMin !== undefined) marks.push({ minutes: sunsetMin, dir: "down", label: "Sunset" });

  const sunHtml = marks
    .filter((s) => s.minutes >= start && s.minutes <= end)
    .map(
      (s) =>
        `<div class="sunmark" style="left:${pct(s.minutes)}" title="${s.label} ${fmtClock(
          s.minutes,
        )}"><span>${sunIcon(s.dir)}</span></div>`,
    )
    .join("");

  const arrivalHtml = arrivals
    .map(
      (a) =>
        `<div class="arrival${a.tentative ? " tentative" : ""}" style="left:${pct(
          a.minutes,
        )}"><span>Arrive ${esc(a.time)}</span></div>`,
    )
    .join("");

  const blockHtml = blocks
    .map((b) => {
      const cls = `blk blk-${b.kind}${b.tentative ? " tentative" : ""}`;
      return `<div class="${cls}" style="left:${pct(b.start)};width:calc(${pct(b.end)} - ${pct(
        b.start,
      )})" title="${esc(b.label)}">${esc(b.label)}</div>`;
    })
    .join("");

  const tickHtml = ticks
    .map((m) => `<span class="tick" style="left:${pct(m)}">${fmtHour(m)}</span>`)
    .join("");

  return `<div class="track">${sunHtml}${arrivalHtml}<div class="trackbar">${blockHtml}</div><div class="ticks">${tickHtml}</div></div>`;
}

// ---------- run of show ----------
function runOfShow({ id, title, trailing, intro, blocks, rows, start, end, tickStep, axisNote }) {
  return `<details class="ros" id="${id}">
    <summary><span class="chev" aria-hidden="true">›</span><span class="rostitle">${esc(
      title,
    )}</span><span class="rotrail">${esc(trailing)}</span></summary>
    <div class="rosbody">
      <p class="t-sec">${esc(intro)}</p>
      ${dayTrack({ blocks, start, end, tickStep })}
      <p class="t-ter small">${esc(axisNote)}</p>
      <div class="subrows">
        ${rows
          .map(
            (row) => `<div class="srow" data-who="${esc(row.who.join("|"))}">
              <span class="t-sec">${esc(rowTime(row))}</span>
              <span>${esc(row.what)}</span>
              <span class="t-ter small">${esc(row.who.join(", "))}</span>
            </div>`,
          )
          .join("")}
      </div>
    </div>
  </details>`;
}

const rosConfig = {
  prephotos: {
    title: "Pre-ceremony photo shoot",
    trailing: "Before the 9:00 AM baraat",
    intro:
      "First looks, private vows and group photos. The bridesmaids' first look is folded into the bridal party photos at the end rather than run separately. Prat heads to the baraat at 8:35 AM, before it starts at 9:00 AM.",
    blocks: prePhotoBlocks,
    start: t(6),
    end: t(8, 45),
    tickStep: 15,
    axisNote:
      "Blue blocks are the moments photo and video must capture, gray is the walk down. Axis: 6:00 AM to 8:45 AM.",
  },
  ceremony: {
    title: "Ceremony · ritual by ritual",
    trailing: "Kanna Bridge",
    intro:
      "Sri Lankan Tamil and Nepali ceremony, from Bernardo's segment timings on the Jul 1 call. Clock times assume the groom's welcome starts at 9:45 AM, so everything shifts together if that moves.",
    blocks: ceremonyBlocks,
    start: t(9, 45),
    end: t(12),
    tickStep: 15,
    axisNote:
      "Green blocks are the ceremony, start to finish. Photo and video cover all of it. Axis: 9:45 AM to 12:00 PM.",
  },
  reception: {
    title: "Reception · full run of show",
    trailing: "Ballroom · black tie",
    intro:
      "Dinner goes before the speeches and dances so nobody is in the buffet line while they happen. Speeches start once the last table is seated and eating.",
    blocks: receptionBlocks,
    start: t(19, 30),
    end: t(25),
    tickStep: 30,
    axisNote:
      "Blue blocks are the moments photo and video must capture, green is the reception itself, gray is prep. Axis: 7:30 PM to 1:00 AM.",
  },
};

// ---------- day cards ----------
function dateBadge(day, isLast) {
  return `<div class="badgecol">
    <div class="datebadge">
      <span class="bweekday">${esc(day.weekday)}</span>
      <span class="bnum">${esc(day.dayNum)}</span>
      <span class="bmon">Oct</span>
    </div>
    ${isLast ? "" : '<div class="connector"></div>'}
  </div>`;
}

function dayCard(day, isLast) {
  const rows = day.rows
    .map((row) => {
      const bold = row.what.startsWith("Photo and video team arrives") || isEvent(row);
      const tone = isEvent(row) ? "is-event" : isPhotoVideo(row) ? "is-shoot" : "";
      const what = row.expand
        ? runOfShow({ id: `${day.id}-${row.expand}`, rows: subRowsFor[row.expand], ...rosConfig[row.expand] })
        : `<span class="${tone} ${bold ? "semib" : ""}">${esc(row.what)}</span>`;
      return `<div class="drow" data-who="${esc(row.who.join("|"))}" data-expand="${esc(row.expand || "")}">
        <span class="${tone} ${bold ? "semib" : ""}">${esc(rowTime(row))}</span>
        <div class="whatcell">${what}</div>
        <span class="t-ter small">${esc(row.source)}</span>
      </div>`;
    })
    .join("");

  return `<div class="dayrow" data-day="${esc(day.id)}">
    ${dateBadge(day, isLast)}
    <div class="daybody">
      <div class="card">
        <div class="cardhead"><span>${esc(day.title)}</span><span class="t-ter small">${esc(
          day.sun,
        )}</span></div>
        <div class="cardbody">
          ${dayTrack(day)}
          <div class="rowhead"><span>Time</span><span>What</span><span>Source</span></div>
          ${rows}
        </div>
      </div>
    </div>
  </div>`;
}

// ---------- week view ----------
function layoutDay(rows) {
  const items = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.start !== undefined && row.end !== undefined)
    .sort((a, b) => a.row.start - b.row.start || b.row.end - b.row.start - (a.row.end - a.row.start));
  const placed = [];
  let cluster = [];
  let colEnds = [];
  let clusterEnd = -1;
  const flush = () => {
    cluster.forEach((p) => (p.cols = colEnds.length));
    cluster = [];
    colEnds = [];
  };
  for (const { row, idx } of items) {
    if (row.start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= row.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(row.end);
    } else {
      colEnds[col] = row.end;
    }
    const p = { row, idx, col, cols: 1 };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, row.end);
  }
  flush();
  return placed;
}

function weekView() {
  const height = ((WEEK_END - WEEK_START) / 60) * HOUR_PX;
  const hours = [];
  for (let m = WEEK_START; m < WEEK_END; m += 60) hours.push(m);
  const top = (m) => ((m - WEEK_START) / 60) * HOUR_PX;

  const head = days
    .map(
      (d) => `<div class="wkhead">
        <div class="bweekday">${esc(d.weekday)}</div>
        <div class="wknum">${esc(d.dayNum)}</div>
        <div class="t-sec small">${esc(d.short)}</div>
      </div>`,
    )
    .join("");

  const tbdRow = days
    .map(
      (d) => `<div class="wktbd">${d.rows
        .filter((row) => row.start === undefined)
        .map(
          (row) =>
            `<div class="wkchip" data-who="${esc(row.who.join("|"))}" title="${esc(
              `${row.what} · ${rowTime(row)}`,
            )}">${esc(row.what)}</div>`,
        )
        .join("")}</div>`,
    )
    .join("");

  const cols = days
    .map((d) => {
      const lines = hours
        .map((m) => `<div class="hline" style="top:${top(m)}px"></div>`)
        .join("");
      const marks = [
        { minutes: d.sunriseMin, dir: "up", label: "Sunrise" },
        { minutes: d.sunsetMin, dir: "down", label: "Sunset" },
      ]
        .map(
          (s) =>
            `<div class="wksun" style="top:${top(s.minutes)}px"><span title="${s.label} ${fmtClock(
              s.minutes,
            )}">${sunIcon(s.dir)}</span></div>`,
        )
        .join("");
      const blocks = layoutDay(d.rows)
        .map(({ row, col, cols: n }) => {
          const h = Math.max(top(row.end) - top(row.start) - 2, 14);
          const w = 100 / n;
          const kind = weekKind(row);
          const cls = `wkblk wk-${kind}${isOption(row) ? " option" : ""}`;
          const detail = esc(
            [
              `${d.weekday}, Oct ${d.dayNum}`,
              row.what,
              rowTime(row),
              row.who.join(", "),
              `${kind === "event" ? "Event" : kind === "shoot" ? "Photo and video" : "Prep or logistics"}${
                isOption(row) ? " · option, not yet picked" : ""
              } · ${row.source}`,
            ].join("\n"),
          );
          return `<div class="${cls}" data-who="${esc(row.who.join("|"))}" data-detail="${detail}"
            style="top:${top(row.start) + 1}px;height:${h}px;left:calc(${col * w}% + 2px);width:calc(${w}% - 4px)"
            title="${esc(`${row.what} · ${shortRange(row)}`)}">
            <div class="wkname">${esc(row.what)}</div>
            ${h >= 30 ? `<div class="wkrange">${esc(shortRange(row))}</div>` : ""}
          </div>`;
        })
        .join("");
      return `<div class="wkcol" data-day="${esc(d.id)}">${lines}${marks}${blocks}</div>`;
    })
    .join("");

  const gutter = hours
    .map(
      (m) =>
        `<span class="wkhour" style="top:${top(m) - 6}px">${m === WEEK_START ? "" : fmtHour(m)}</span>`,
    )
    .join("");

  return `<div class="weekwrap">
    <div class="weekgrid">
      <div class="wkheadrow"><div></div>${head}</div>
      <div class="wktbdrow"><div class="wktbdlabel">Time TBD</div>${tbdRow}</div>
      <div class="wkbody" style="height:${height}px">
        <div class="wkgutter">${gutter}</div>
        ${cols}
      </div>
    </div>
    <aside class="wkdetail" hidden><div class="card"><div class="cardhead"><span id="wkdt">Details</span><button id="wkclose" type="button">Close</button></div><div class="cardbody" id="wkdb"></div></div></aside>
  </div>`;
}

// ---------- packing + ceremony sections ----------
function itemList(items, nameKey, noteKeys) {
  return `<ul class="plain">${items
    .map((it) => {
      const notes = noteKeys
        .map((k) => it[k])
        .filter(Boolean)
        .map((n) => `<p class="t-ter small">${esc(n)}</p>`)
        .join("");
      return `<li><span class="semib">${esc(it[nameKey])}</span>${
        it.tag ? ` <span class="pill">${esc(it.tag)}</span>` : ""
      }${notes}</li>`;
    })
    .join("")}</ul>`;
}

function sectionCard(title, meta, inner) {
  return `<div class="card">
    <div class="cardhead"><span>${esc(title)}</span>${meta ? `<span class="t-ter small">${esc(meta)}</span>` : ""}</div>
    <div class="cardbody">${inner}</div>
  </div>`;
}

const packingHtml = packingEvents
  .map((ev) =>
    sectionCard(
      ev.title,
      `${ev.when} · ${ev.where}`,
      `<div class="cols">${ev.groups
        .map((g) => `<div><h4>${esc(g.who)}</h4>${itemList(g.items, "name", ["note"])}</div>`)
        .join("")}</div>`,
    ),
  )
  .join("");

const ceremonyHtml = [
  ...columns.map((c) => sectionCard(c.who, c.detail || "", itemList(c.items, "name", ["note"]))),
  sectionCard("Coming from the resort and the vendors", "", itemList(resortItems, "name", ["note"])),
  sectionCard("Closed by the decor quote", "", itemList(closedByDecor, "name", ["detail"])),
  sectionCard("Still without an owner", "", itemList(unowned, "name", ["problem", "suggestion"])),
  sectionCard(
    "Petal throwers",
    `${petalBrideSide.length} on the bride's side · ${petalGroomSide.length} on the groom's`,
    `<div class="cols"><div><h4>Bride's side</h4><ul>${petalBrideSide
      .map((n) => `<li>${esc(n)}</li>`)
      .join("")}</ul></div><div><h4>Groom's side</h4><ul>${petalGroomSide
      .map((n) => `<li>${esc(n)}</li>`)
      .join("")}</ul></div></div>`,
  ),
  sectionCard("Settled roles", "", itemList(settledRoles, "question", ["answer", "note"])),
  sectionCard("Roles still open", "", itemList(openRoles, "question", ["context"])),
  sectionCard("What the priest is bringing", "", itemList(bernardoSends, "what", ["note"])),
].join("");

const asksHtml = asks.vendors
  .map((v) =>
    sectionCard(
      v.who,
      `${v.role} · ${v.questions.length} open`,
      `<div class="asklist">${v.questions
        .map(
          (q) => `<div class="ask"><p class="semib">${esc(q.q)}${
            q.status ? ` <span class="pill">${esc(q.status)}</span>` : ""
          }</p><p class="t-ter small">${esc(q.context)}</p></div>`,
        )
        .join("")}</div>`,
    ),
  )
  .join("");

const legend = `<div class="card">
  <div class="cardhead"><span>Legend</span></div>
  <div class="cardbody"><div class="cols">
    <div>
      <h4>Timeline bars</h4>
      <div class="leg"><span class="sw sw-shoot"></span><span class="t-sec small">Photo and video shoot</span></div>
      <div class="leg"><span class="sw sw-shoot-d"></span><span class="t-sec small">Shoot, not yet timed or confirmed</span></div>
      <div class="leg"><span class="sw sw-event"></span><span class="t-sec small">Event</span></div>
      <div class="leg"><span class="sw sw-prep"></span><span class="t-sec small">Prep or logistics</span></div>
      <div class="leg"><span class="sw sw-arr"></span><span class="t-sec small">Team arrival (dashed = only if that option is picked)</span></div>
      <div class="leg"><span class="sw sw-sun">${sunIcon("down")}</span><span class="t-sec small">Sunrise (arrow up) and sunset (arrow down)</span></div>
    </div>
    <div>
      <h4>Schedule text</h4>
      <div class="leg"><span class="legsample is-event semib">Event</span><span class="t-sec small">Main events</span></div>
      <div class="leg"><span class="legsample is-shoot">Shoot</span><span class="t-sec small">Photo and video related</span></div>
      <div class="leg"><span class="legsample semib">Arrival</span><span class="t-sec small">Photo and video team arrival</span></div>
      <div class="leg"><span class="legsample t-ter">Source</span><span class="t-sec small">Where the time came from</span></div>
    </div>
  </div>
  <p class="t-ter small divtop">Times are local resort time (Quintana Roo, no daylight saving). Bars run 2 AM to 1 AM.</p>
  </div>
</div>`;

const weekStrip = days
  .map(
    (d) => `<button type="button" class="stripday" data-day="${esc(d.id)}">
      <span class="bweekday">${esc(d.weekday)}</span>
      <span class="stripnum">${esc(d.dayNum)}</span>
      <span class="t-sec small">${esc(d.short)}</span>
      ${d.summary
        .map((s) => `<span class="${s.firm ? "firm" : "t-ter"} small">${esc(s.text)}</span>`)
        .join("")}
    </button>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Simran and Prat's Wedding Schedule</title>
<style>
:root {
  --t1: #1a1a1f;
  --t2: #51515c;
  --t3: #86868f;
  --t4: #a8a8b0;
  --bg: #ffffff;
  --chrome: #f7f7f8;
  --fill2: #f2f2f4;
  --fill3: #ebebee;
  --s2: #dededf;
  --s3: #eaeaec;
  --accent: #2f6feb;
  --green: #1a7f4b;
  --amber: #8a5a00;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--t1);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1120px; margin: 0 auto; padding: 32px 24px 80px; display: flex; flex-direction: column; gap: 24px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0; letter-spacing: -0.4px; font-weight: 600; }
h2 { font-size: 19px; margin: 0; font-weight: 600; }
h4 { font-size: 13px; margin: 0 0 8px; font-weight: 600; }
p { margin: 0; }
.small { font-size: 12.5px; }
.semib { font-weight: 600; }
.t-sec { color: var(--t2); }
.t-ter { color: var(--t3); }
.is-event { color: var(--green); font-weight: 600; }
.is-shoot { color: var(--accent); }

/* tabs */
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--s2); }
.tab {
  cursor: pointer; padding: 8px 16px; margin-bottom: -1px; font-size: 14px;
  color: var(--t2); background: none; border: 0; border-bottom: 2px solid transparent; font-family: inherit;
}
.tab[aria-selected="true"] { color: var(--t1); font-weight: 600; border-bottom-color: var(--accent); }

/* cards */
.card { background: var(--bg); border: 1px solid var(--s2); border-radius: 10px; overflow: hidden; }
.cardhead {
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
  padding: 12px 16px; border-bottom: 1px solid var(--s3); font-weight: 600; background: var(--bg);
}
.cardbody { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }
.stack { display: flex; flex-direction: column; gap: 12px; }

/* week strip */
.strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.stripday {
  cursor: pointer; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--s3);
  background: none; display: flex; flex-direction: column; gap: 2px; text-align: left; font-family: inherit;
}
.stripday[aria-pressed="true"] { border-color: var(--accent); background: var(--fill3); }
.bweekday { font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--t3); }
.stripnum { font-size: 22px; line-height: 26px; font-weight: 600; }
.firm { color: var(--accent); font-weight: 600; }

/* filter */
.filterbar { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.pills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.pill, .btn {
  font-size: 12px; border: 1px solid var(--s2); border-radius: 999px; padding: 3px 10px;
  background: var(--bg); color: var(--t2); cursor: pointer; font-family: inherit; white-space: nowrap;
}
.pill[aria-pressed="true"] { background: var(--t1); color: #fff; border-color: var(--t1); }
span.pill { cursor: default; color: var(--amber); }
.btn:hover { border-color: var(--t3); }

/* day rows */
.dayrow { display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 16px; align-items: stretch; }
.badgecol { display: flex; flex-direction: column; align-items: center; }
.datebadge {
  width: 60px; padding: 8px 0; border-radius: 8px; border: 1px solid var(--s2);
  background: var(--chrome); display: flex; flex-direction: column; align-items: center;
}
.datebadge .bnum { font-size: 20px; line-height: 24px; font-weight: 600; }
.datebadge .bmon { font-size: 10px; color: var(--t3); }
.connector { flex: 1; width: 1px; background: var(--s3); margin-top: 6px; }
.daybody { padding-bottom: 20px; }

/* track */
.track { position: relative; padding: 18px 0; }
.trackbar {
  position: relative; height: 26px; background: var(--chrome);
  border-radius: 4px; border: 1px solid var(--s3);
}
.blk {
  position: absolute; top: 0; bottom: 0; border-radius: 4px; padding: 0 6px; box-sizing: border-box;
  font-size: 11px; line-height: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.blk-shoot { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
.blk-shoot.tentative { background: transparent; color: var(--accent); border-style: dashed; }
.blk-event { background: var(--green); color: #fff; border-left: 1px solid var(--chrome); border-right: 1px solid var(--chrome); }
.blk-prep { background: var(--fill3); color: var(--t2); }
.blk-prep.tentative { background: transparent; border: 1px dashed var(--s2); }
.arrival { position: absolute; top: 0; bottom: 14px; border-left: 2px solid var(--t1); }
.arrival.tentative { border-left-style: dashed; }
.arrival span { position: absolute; top: 0; left: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.sunmark { position: absolute; top: 14px; bottom: 14px; border-left: 1px dotted var(--t3); }
.sunmark > span { position: absolute; top: -14px; left: -6px; line-height: 0; color: var(--t2); }
.sunicon { width: 12px; height: 12px; }
.ticks { position: relative; height: 14px; margin-top: 4px; }
.tick { position: absolute; transform: translateX(-50%); font-size: 10px; color: var(--t3); white-space: nowrap; }

/* schedule rows */
.rowhead, .drow { display: grid; grid-template-columns: 250px minmax(0, 1fr) 96px; gap: 20px; }
.rowhead {
  padding: 0 0 6px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase;
  color: var(--t3); border-bottom: 1px solid var(--s2);
}
.drow { align-items: start; padding: 6px 0; border-bottom: 1px solid var(--s3); }
.drow:last-child { border-bottom: 0; }
.whatcell { min-width: 0; }

/* run of show */
.ros { border: 1px solid var(--s3); border-radius: 8px; background: var(--chrome); }
.ros summary {
  cursor: pointer; padding: 8px 12px; display: flex; align-items: center; gap: 8px; list-style: none;
}
.ros summary::-webkit-details-marker { display: none; }
.chev { color: var(--t3); transition: transform 0.12s; display: inline-block; }
.ros[open] .chev { transform: rotate(90deg); }
.rostitle { font-weight: 600; }
.rotrail { margin-left: auto; color: var(--t3); font-size: 12px; }
.rosbody { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.subrows { display: flex; flex-direction: column; }
.srow {
  display: grid; grid-template-columns: 180px minmax(0, 1fr) 180px; gap: 16px;
  padding: 5px 0; border-top: 1px solid var(--s3); font-size: 13px;
}

/* week view */
.weekwrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.weekwrap.withdetail { grid-template-columns: minmax(0, 1fr) 300px; }
.weekgrid { border: 1px solid var(--s3); border-radius: 8px; overflow: hidden; }
.wkheadrow, .wktbdrow, .wkbody { display: grid; grid-template-columns: 56px repeat(5, minmax(0, 1fr)); }
.wkheadrow { border-bottom: 1px solid var(--s3); background: var(--chrome); }
.wkhead { padding: 8px 0; text-align: center; border-left: 1px solid var(--s3); }
.wknum { font-size: 22px; line-height: 26px; font-weight: 500; }
.wktbdrow { border-bottom: 1px solid var(--s2); }
.wktbdlabel { font-size: 10px; color: var(--t3); text-align: right; padding: 6px 8px 0 0; }
.wktbd { border-left: 1px solid var(--s3); padding: 3px; display: flex; flex-direction: column; gap: 3px; min-height: 24px; }
.wkchip {
  font-size: 11px; line-height: 14px; padding: 2px 4px; border-radius: 4px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; border: 1px dashed var(--s2); color: var(--t2);
}
.wkbody { position: relative; }
.wkgutter { position: relative; }
.wkhour { position: absolute; right: 8px; font-size: 10px; color: var(--t3); white-space: nowrap; }
.wkcol { position: relative; border-left: 1px solid var(--s3); }
.hline { position: absolute; left: 0; right: 0; border-top: 1px solid var(--s3); }
.wksun { position: absolute; left: 0; right: 0; border-top: 1px dotted var(--t3); z-index: 2; pointer-events: none; }
.wksun > span { position: absolute; top: -6px; left: 2px; line-height: 0; color: var(--t2); background: var(--bg); border-radius: 2px; pointer-events: auto; }
.wksun .sunicon { width: 11px; height: 11px; }
.wkblk {
  position: absolute; border-radius: 4px; padding: 2px 4px; overflow: hidden; cursor: pointer;
  font-size: 11px; line-height: 14px; z-index: 1;
}
.wkblk.sel { outline: 2px solid var(--t1); outline-offset: 1px; z-index: 3; }
.wkname { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wkrange { opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wk-shoot { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
.wk-event { background: var(--green); color: #fff; border: 1px solid var(--green); }
.wk-prep { background: var(--fill2); color: var(--t1); border: 1px solid var(--s3); }
.wk-shoot.option { background: var(--bg); color: var(--accent); border: 1px dashed var(--accent); }
.wk-event.option { background: var(--bg); color: var(--green); border: 1px dashed var(--green); }
.wk-prep.option { background: var(--bg); color: var(--t2); border: 1px dashed var(--s2); }
.wkdetail { position: sticky; top: 16px; }
.wkdetail .cardbody { white-space: pre-line; font-size: 13px; }
#wkclose { border: 0; background: none; color: var(--t2); cursor: pointer; font-family: inherit; font-size: 13px; }

/* legend + lists */
.leg { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sw { display: inline-block; width: 14px; height: 10px; border-radius: 2px; flex: none; }
.sw-shoot { background: var(--accent); }
.sw-shoot-d { border: 1px dashed var(--accent); }
.sw-event { background: var(--green); }
.sw-prep { background: var(--fill3); }
.sw-arr { width: 2px; height: 12px; border-radius: 0; border-left: 2px solid var(--t1); }
.sw-sun { width: 14px; height: 12px; color: var(--t2); line-height: 0; }
.legsample { font-size: 12px; min-width: 64px; }
.divtop { border-top: 1px solid var(--s3); padding-top: 12px; }
ul { margin: 0; padding-left: 18px; }
.plain { list-style: none; padding-left: 0; }
li { margin-bottom: 10px; }
.asklist { display: flex; flex-direction: column; gap: 10px; }
.ask { border-left: 2px solid var(--amber); padding-left: 12px; }
.sectiongrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; align-items: start; }
footer { color: var(--t3); font-size: 12px; border-top: 1px solid var(--s3); padding-top: 14px; }
[hidden] { display: none !important; }

@media (max-width: 820px) {
  .rowhead, .drow { grid-template-columns: 1fr; gap: 2px; }
  .rowhead { display: none; }
  .drow { padding: 10px 0; }
  .srow { grid-template-columns: 1fr; gap: 2px; }
  .dayrow { grid-template-columns: 1fr; }
  .badgecol { display: none; }
  .strip { grid-template-columns: repeat(2, 1fr); }
  .weekgrid { overflow-x: auto; }
}
</style>
</head>
<body>
<div class="wrap">
  <div class="stack" style="gap:6px">
    <h1>Simran and Prat's Wedding Schedule</h1>
    <p class="t-sec">Paradisus Playa del Carmen · Oct 20–24, 2026 · Jakobz Media. Arrival times assume
    a 30-minute setup buffer before each shoot. This is a live working plan, not a final vendor
    schedule — the date at the bottom tells you how fresh it is.</p>
  </div>

  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="day" aria-selected="true">Day by day</button>
    <button class="tab" role="tab" data-tab="week" aria-selected="false">Week at a glance</button>
    <button class="tab" role="tab" data-tab="lists" aria-selected="false">Packing and items</button>
    <button class="tab" role="tab" data-tab="asks" aria-selected="false">Open questions</button>
  </div>

  <section data-panel="day" class="stack" style="gap:24px">
    <div class="stack" style="gap:8px">
      <div class="strip">${weekStrip}</div>
      <p class="t-ter small">Click a day to focus on it, click again to show all. Bold times are
      proposed arrivals for scheduled events; gray times depend on a decision that hasn't been made yet.</p>
    </div>

    <div class="stack">
      <div class="filterbar">
        <h2 style="margin-right:auto">Day by day</h2>
        <span id="showing" class="small" style="color:var(--accent)" hidden></span>
        <button class="btn" id="clearfilter" type="button" hidden>Clear</button>
        <button class="btn" id="togglefilter" type="button">Filter by person</button>
      </div>
      <div class="pills" id="peoplepills" hidden>
        <button class="pill" data-person="" aria-pressed="true" type="button">Everyone</button>
        ${people.map((p) => `<button class="pill" data-person="${esc(p)}" aria-pressed="false" type="button">${esc(p)}</button>`).join("")}
      </div>
      ${legend}
    </div>

    <div class="stack" style="gap:0" id="days">
      ${days.map((d, i) => dayCard(d, i === days.length - 1)).join("")}
    </div>

    <p class="t-ter small">Source key: "In timeline" = Primary Timeline v2026-09-22 or Bernardo's
    ceremony timeline · "Derived" = worked out from a rule in the timeline · "New" = added by Simran ·
    "Proposed" = suggested arrival, not yet confirmed with Jakobz Media.</p>
  </section>

  <section data-panel="week" hidden class="stack">
    <p class="t-ter small">Oct 20–24, 2026 · local resort time, 2 AM to 1 AM. Solid blue = photo and
    video shoot, dashed = option not yet picked, green = event, gray = prep or logistics. The dotted
    lines are sunrise (arrow up) and sunset (arrow down). Click a block for details.</p>
    ${weekView()}
  </section>

  <section data-panel="lists" hidden class="stack" style="gap:24px">
    <div class="stack">
      <h2>Ceremony items and who brings them</h2>
      <div class="sectiongrid">${ceremonyHtml}</div>
    </div>
    <div class="stack">
      <h2>Packing, event by event</h2>
      <div class="sectiongrid">${packingHtml}${sectionCard(
        "Across every event",
        "",
        itemList(acrossEvents, "name", ["note"]),
      )}</div>
    </div>
  </section>

  <section data-panel="asks" hidden class="stack" style="gap:24px">
    <div class="stack">
      <h2>Open questions, by vendor</h2>
      <div class="sectiongrid">${asksHtml}</div>
    </div>
    <div class="stack">
      <h2>Things we are still watching</h2>
      <div class="sectiongrid">${openItems
        .map((it) => sectionCard(it.title, "", `<p class="t-sec small">${esc(it.body)}</p>`))
        .join("")}</div>
    </div>
  </section>

  <footer>Last updated ${new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })} · generated from Simran's planning canvases · please don't pass the link on</footer>
</div>

<script>
(function () {
  var tabs = document.querySelectorAll(".tab");
  var panels = document.querySelectorAll("[data-panel]");
  tabs.forEach(function (tb) {
    tb.addEventListener("click", function () {
      tabs.forEach(function (o) { o.setAttribute("aria-selected", String(o === tb)); });
      panels.forEach(function (p) { p.hidden = p.dataset.panel !== tb.dataset.tab; });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // Focus a single day
  var strip = document.querySelectorAll(".stripday");
  var selectedDay = null;
  function applyDay() {
    document.querySelectorAll(".dayrow").forEach(function (dr) {
      dr.hidden = selectedDay !== null && dr.dataset.day !== selectedDay;
    });
    strip.forEach(function (s) {
      s.setAttribute("aria-pressed", String(s.dataset.day === selectedDay));
    });
  }
  strip.forEach(function (s) {
    s.addEventListener("click", function () {
      selectedDay = selectedDay === s.dataset.day ? null : s.dataset.day;
      applyDay();
    });
  });

  // Filter by person
  var chosen = [];
  var pillWrap = document.getElementById("peoplepills");
  var showing = document.getElementById("showing");
  var clearBtn = document.getElementById("clearfilter");
  document.getElementById("togglefilter").addEventListener("click", function () {
    pillWrap.hidden = !pillWrap.hidden;
    this.textContent = pillWrap.hidden ? "Filter by person" : "Hide filter";
  });
  function matches(el) {
    if (!chosen.length) return true;
    var who = (el.dataset.who || "").split("|");
    return chosen.some(function (c) { return who.indexOf(c) !== -1; });
  }
  function applyFilter() {
    document.querySelectorAll(".srow").forEach(function (sr) { sr.hidden = !matches(sr); });
    document.querySelectorAll(".drow").forEach(function (dr) {
      var kept = matches(dr);
      if (!kept && dr.dataset.expand) {
        kept = dr.querySelectorAll(".srow:not([hidden])").length > 0;
      }
      dr.hidden = !kept;
    });
    document.querySelectorAll(".wkblk, .wkchip").forEach(function (b) { b.hidden = !matches(b); });
    document.querySelectorAll(".dayrow").forEach(function (dr) {
      if (selectedDay !== null && dr.dataset.day !== selectedDay) return;
      dr.hidden = dr.querySelectorAll(".drow:not([hidden])").length === 0;
    });
    showing.hidden = !chosen.length;
    clearBtn.hidden = !chosen.length;
    showing.textContent = chosen.length ? "Showing " + chosen.join(", ") : "";
    pillWrap.querySelectorAll(".pill").forEach(function (p) {
      p.setAttribute(
        "aria-pressed",
        String(p.dataset.person ? chosen.indexOf(p.dataset.person) !== -1 : chosen.length === 0)
      );
    });
  }
  pillWrap.querySelectorAll(".pill").forEach(function (p) {
    p.addEventListener("click", function () {
      var who = p.dataset.person;
      if (!who) chosen = [];
      else {
        var at = chosen.indexOf(who);
        if (at === -1) chosen.push(who); else chosen.splice(at, 1);
      }
      applyFilter();
    });
  });
  clearBtn.addEventListener("click", function () { chosen = []; applyFilter(); });

  // Week view detail panel
  var wrapEl = document.querySelector(".weekwrap");
  var detail = document.querySelector(".wkdetail");
  var dtTitle = document.getElementById("wkdt");
  var dtBody = document.getElementById("wkdb");
  var current = null;
  function closeDetail() {
    if (current) current.classList.remove("sel");
    current = null;
    detail.hidden = true;
    wrapEl.classList.remove("withdetail");
  }
  document.getElementById("wkclose").addEventListener("click", closeDetail);
  document.querySelectorAll(".wkblk").forEach(function (b) {
    b.addEventListener("click", function () {
      if (current === b) return closeDetail();
      if (current) current.classList.remove("sel");
      current = b;
      b.classList.add("sel");
      var parts = (b.dataset.detail || "").split("\\n");
      dtTitle.textContent = parts.shift();
      dtBody.textContent = parts.join("\\n");
      detail.hidden = false;
      wrapEl.classList.add("withdetail");
    });
  });
})();
</script>
</body>
</html>
`;

const leaked = html.match(/\$\s?[\d,]+/g);
if (leaked) throw new Error(`Refusing to build: pricing leaked into the page — ${leaked.join(", ")}`);

mkdirSync(here, { recursive: true });
writeFileSync(join(here, "index.html"), html);
console.log(
  `Wrote index.html — ${days.length} days, ${packingEvents.length} packing events, ${asks.vendors.length} vendor question sets`,
);
