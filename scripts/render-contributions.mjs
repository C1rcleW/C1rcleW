#!/usr/bin/env node
// Usage: node scripts/render-contributions.mjs <github-handle> [--placeholder]
// In Actions, GITHUB_LOGIN is provided by the workflow.

import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.resolve(process.env.CONTRIBUTION_OUTPUT || "assets/contributions.svg");
const args = process.argv.slice(2);
const placeholder = args.includes("--placeholder");
const argLogin = args.find((arg) => !arg.startsWith("--"));
const login = (argLogin || process.env.GITHUB_LOGIN || "").trim();
const DAY = 86_400_000;

const COLOR = {
  bg: "#0B0D0F",
  ink: "#EDEFEA",
  muted: "#9AA1A6",
  dim: "#6F777D",
  blue: "#8AB4F8",
  green: "#34A853",
  levels: ["#191D1F", "#174EA6", "#1E8E3E", "#F9AB00", "#D93025"],
};
const ACCENT = "url(#googleAccent)";

const MONO = "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const GRID = { x: 100, y: 112, cell: 12, gap: 3.5 };
const STEP = GRID.cell + GRID.gap;

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]);

const parseDate = (isoDate) => new Date(`${isoDate}T00:00:00Z`);
const isoDate = (date) => date.toISOString().slice(0, 10);
const commas = (value) => value.toLocaleString("en-US");
const coord = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseContributions(html) {
  const counts = new Map();
  for (const match of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g)) {
    const text = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const numeric = text.match(/^(\d+)\s+contributions?\b/i);
    if (numeric) counts.set(match[1], Number(numeric[1]));
    else if (/^No contributions\b/i.test(text)) counts.set(match[1], 0);
  }

  const days = new Map();
  let incomplete = 0;
  for (const match of html.matchAll(/<td\b[^>]*\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
    const tag = match[0];
    const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
    const level = Number((tag.match(/\bdata-level="(\d)"/) || [])[1]);
    const count = id ? counts.get(id) : undefined;
    if (!id || !Number.isInteger(level) || count === undefined) {
      incomplete += 1;
      continue;
    }
    days.set(match[1], {
      date: match[1],
      level: Math.max(0, Math.min(4, level)),
      count,
    });
  }

  if (incomplete > 0) {
    throw new Error(`Contribution page had ${incomplete} unreadable day cells; chart not updated.`);
  }

  const data = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (data.length < 300) {
    throw new Error(`Only found ${data.length} contribution days; chart not updated.`);
  }
  return data;
}

async function fetchContributions(handle) {
  const url = `https://github.com/users/${encodeURIComponent(handle)}/contributions`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html",
          "cache-control": "no-cache",
          "user-agent": "contribution-log/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      return parseContributions(await response.text());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1_500 * attempt);
    }
  }
  throw new Error(`Could not read ${url}: ${lastError.message}`);
}

function placeholderData() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 52 * 7);
  const data = [];
  for (let time = start.getTime(); time <= end.getTime(); time += DAY) {
    const date = new Date(time);
    data.push({ date: isoDate(date), level: 0, count: 0 });
  }
  return data;
}

function buildStats(data) {
  const total = data.reduce((sum, day) => sum + day.count, 0);
  const activeDays = data.filter((day) => day.count > 0).length;

  let longest = 0;
  let run = 0;
  for (const day of data) {
    if (day.count > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let current = 0;
  for (let index = data.length - 1; index >= 0; index -= 1) {
    if (data[index].count > 0) {
      current += 1;
    } else if (index !== data.length - 1) {
      break;
    }
  }

  return { total, activeDays, longest, current };
}

function buildTimestamp() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const now = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())} / ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;
}

function render(data, handle) {
  const firstDate = parseDate(data[0].date);
  const origin = new Date(firstDate);
  origin.setUTCDate(origin.getUTCDate() - origin.getUTCDay());
  const columnOf = (date) => Math.floor((parseDate(date) - origin) / DAY / 7);

  const cells = data
    .map((day) => {
      const date = parseDate(day.date);
      const x = GRID.x + columnOf(day.date) * STEP;
      const y = GRID.y + date.getUTCDay() * STEP;
      return `<rect x="${coord(x)}" y="${coord(y)}" width="${GRID.cell}" height="${GRID.cell}" fill="${COLOR.levels[day.level]}"/>`;
    })
    .join("");

  let lastMonth = -1;
  let lastLabelX = -100;
  const monthLabels = [];
  for (const day of data) {
    const date = parseDate(day.date);
    const month = date.getUTCMonth();
    if (month === lastMonth) continue;
    const x = GRID.x + columnOf(day.date) * STEP;
    const isInitialMonth = lastMonth === -1;
    if ((!isInitialMonth || date.getUTCDate() === 1) && x - lastLabelX >= 32) {
      monthLabels.push(
        `<text x="${coord(x)}" y="96" font-family="${MONO}" font-size="9" letter-spacing="1.4" fill="${COLOR.muted}">${MONTHS[month]}</text>`,
      );
      lastLabelX = x;
    }
    lastMonth = month;
  }

  const weekdayLabels = [
    [1, "MON"],
    [3, "WED"],
    [5, "FRI"],
  ]
    .map(
      ([row, label]) =>
        `<text x="${GRID.x - 12}" y="${coord(GRID.y + row * STEP + 9.4)}" text-anchor="end" font-family="${MONO}" font-size="8.5" letter-spacing="0.8" fill="${COLOR.dim}">${label}</text>`,
    )
    .join("");

  const stats = buildStats(data);
  const totalText = placeholder ? "—" : commas(stats.total);
  const totalSize = totalText.length >= 7 ? 34 : totalText.length >= 6 ? 38 : 46;
  const statRows = [
    ["ACTIVE DAYS", placeholder ? "—" : commas(stats.activeDays)],
    ["CURRENT STREAK", placeholder ? "—" : `${stats.current}D`],
    ["LONGEST STREAK", placeholder ? "—" : `${stats.longest}D`],
  ]
    .map(([label, value], index) => {
      const y = 198 + index * 20;
      const isCurrent = label === "CURRENT STREAK" && !placeholder;
      return `<text x="978" y="${y}" font-family="${MONO}" font-size="9.5" letter-spacing="1.3" fill="${COLOR.dim}">${label}</text><text x="1136" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="0.5" fill="${isCurrent ? COLOR.blue : COLOR.ink}">${value}</text>`;
    })
    .join("");

  const legend = COLOR.levels
    .map((color, index) => `<rect x="${100 + index * 14}" y="271" width="10" height="10" fill="${color}"/>`)
    .join("");

  const displayHandle = escapeXml(handle);
  const stamp = buildTimestamp();
  const status = placeholder ? "AWAITING FIRST SYNC" : `SYNCED ${stamp}`;
  const statusDot = placeholder ? COLOR.dim : COLOR.green;
  const description = placeholder
    ? "Placeholder contribution log. The first GitHub Actions run will populate this chart with public contribution data."
    : `Public GitHub contributions for the last 12 months: ${commas(stats.total)} contributions across ${commas(stats.activeDays)} active days.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300" role="img" aria-labelledby="activityTitle activityDesc">
  <title id="activityTitle">Contribution log for @${displayHandle}</title>
  <desc id="activityDesc">${escapeXml(description)}</desc>
  <defs>
    <linearGradient id="googleAccent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4285F4"/>
      <stop offset="0.34" stop-color="#EA4335"/>
      <stop offset="0.67" stop-color="#FBBC05"/>
      <stop offset="1" stop-color="#34A853"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="300" fill="${COLOR.bg}"/>
  <rect x="0.5" y="0.5" width="1199" height="299" fill="none" stroke="${COLOR.ink}" stroke-opacity="0.12"/>

  <rect x="64" y="33" width="24" height="6" fill="${ACCENT}"/>
  <text x="96" y="41" font-family="${MONO}" font-size="11" letter-spacing="2.2" fill="${COLOR.muted}">CONTRIBUTION LOG</text>
  <text x="1136" y="41" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2.2" fill="${COLOR.dim}">@${displayHandle} / 12M</text>
  <rect x="64" y="63" width="1072" height="2" fill="${ACCENT}"/>

  ${monthLabels.join("")}
  ${weekdayLabels}
  <g shape-rendering="crispEdges">${cells}</g>

  <line x1="946" y1="84" x2="946" y2="244" stroke="${COLOR.ink}" stroke-opacity="0.14"/>

  <text x="978" y="102" font-family="${MONO}" font-size="9.5" letter-spacing="1.6" fill="${COLOR.dim}">TOTAL / 12M</text>
  <text x="978" y="154" font-family="${MONO}" font-size="${totalSize}" fill="${placeholder ? COLOR.dim : COLOR.ink}">${totalText}</text>
  <rect x="978" y="166" width="44" height="2" fill="${ACCENT}"/>
  ${statRows}

  <line x1="64" y1="250" x2="1136" y2="250" stroke="${COLOR.ink}" stroke-opacity="0.14"/>
  <text x="64" y="281" font-family="${MONO}" font-size="8.5" letter-spacing="0.8" fill="${COLOR.dim}">LESS</text>
  ${legend}
  <text x="174" y="281" font-family="${MONO}" font-size="8.5" letter-spacing="0.8" fill="${COLOR.dim}">MORE</text>
  <text x="300" y="281" font-family="${MONO}" font-size="9" letter-spacing="1.4" fill="${COLOR.dim}">PUBLIC CONTRIBUTIONS / AUTO-GENERATED</text>
  <text x="1136" y="281" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="1.2" fill="${COLOR.dim}"><tspan fill="${statusDot}">●</tspan> ${status}</text>
</svg>
`;
}

if (!placeholder && !login) {
  throw new Error("Provide a GitHub handle: node scripts/render-contributions.mjs <handle>");
}
if (!placeholder && !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) {
  throw new Error(`"${login}" does not look like a GitHub handle.`);
}

const data = placeholder ? placeholderData() : await fetchContributions(login);
const handle = placeholder ? login || "YOUR-HANDLE" : login;
const svg = render(data, handle);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, svg, "utf8");
console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${data.length} days${placeholder ? ", placeholder" : `, @${login}`}).`);
