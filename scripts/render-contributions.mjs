#!/usr/bin/env node
// Usage: node scripts/render-contributions.mjs <github-handle> [--placeholder]
// In Actions, GITHUB_LOGIN is provided by the workflow.
// For offline/local renders, set CONTRIBUTION_JSON to a contributions export with {date,count,level}[] entries.
// Output: assets/contributions.svg — paper data plate for the C1RCLE / wireframe CV system.

import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.resolve(process.env.CONTRIBUTION_OUTPUT || "assets/contributions.svg");
const args = process.argv.slice(2);
const placeholder = args.includes("--placeholder");
const argLogin = args.find((arg) => !arg.startsWith("--"));
const login = (argLogin || process.env.GITHUB_LOGIN || "").trim();
const DAY = 86_400_000;

const COLOR = {
  paper: "#E9EBE3",
  ink: "#0A0C0D",
  muted: "#6B7168",
  dim: "#8B9188",
  blue: "#4285F4",
  red: "#EA4335",
  yellow: "#FBBC05",
  green: "#34A853",
  band: "#0A0C0D",
  levels: ["#DADCE0", "#174EA6", "#1E8E3E", "#F9AB00", "#D93025"],
};

const MONO = "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";
const DISPLAY = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const GRID = { x: 100, y: 112, cell: 11.5, gap: 3.5 };
const STEP = GRID.cell + GRID.gap;
const W = 1200;
const H = 360;

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

async function readContributionJson(file) {
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  const list = Array.isArray(raw.contributions) ? raw.contributions : [];
  if (list.length < 300) {
    throw new Error(`Only found ${list.length} contribution days in ${file}; chart not updated.`);
  }
  return list
    .map(({ date, count, level }) => ({
      date,
      count: Number(count) || 0,
      level: Math.max(0, Math.min(4, Number(level) || 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
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
          "user-agent": "contribution-log/2.0",
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
      if (day.level === 0) {
        return `<rect x="${coord(x)}" y="${coord(y)}" width="${GRID.cell}" height="${GRID.cell}" fill="${COLOR.levels[0]}"/>`;
      }
      const shadow = `<rect x="${coord(x + 1.3)}" y="${coord(y + 1.3)}" width="${GRID.cell}" height="${GRID.cell}" fill="${COLOR.ink}" opacity="0.16"/>`;
      const stroke = ` stroke="${COLOR.ink}" stroke-width="0.35" stroke-opacity="0.3"`;
      return `${shadow}<rect x="${coord(x)}" y="${coord(y)}" width="${GRID.cell}" height="${GRID.cell}" fill="${COLOR.levels[day.level]}"${stroke}/>`;
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
        `<text x="${coord(x)}" y="94" font-family="${MONO}" font-size="8.8" letter-spacing="1.4" fill="${COLOR.muted}">${MONTHS[month]}</text>`,
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
      const y = 218 + index * 28;
      const isCurrent = label === "CURRENT STREAK" && !placeholder;
      const marker = label === "CURRENT STREAK" ? COLOR.blue : label === "ACTIVE DAYS" ? COLOR.green : COLOR.red;
      return `<rect x="954" y="${y - 8}" width="4" height="4" fill="${placeholder ? COLOR.dim : marker}" stroke="${COLOR.ink}" stroke-width="0.5"/><text x="968" y="${y}" font-family="${MONO}" font-size="9.2" letter-spacing="1.2" fill="${COLOR.muted}">${label}</text><text x="1136" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="0.5" fill="${COLOR.ink}">${value}</text><line x1="954" y1="${y + 10}" x2="1136" y2="${y + 10}" stroke="${COLOR.ink}" stroke-width="0.6" opacity="0.14"/>`;
    })
    .join("");

  const legend = COLOR.levels
    .map((color, index) => `<rect x="${100 + index * 17}" y="316" width="11" height="11" fill="${color}" stroke="${COLOR.ink}" stroke-width="0.35" stroke-opacity="0.3"/>`)
    .join("");

  const displayHandle = escapeXml(handle);
  const stamp = buildTimestamp();
  const status = placeholder ? "AWAITING FIRST SYNC" : `SYNCED ${stamp}`;
  const statusDot = placeholder ? COLOR.dim : COLOR.green;
  const description = placeholder
    ? "Placeholder contribution log. The first GitHub Actions run will populate this chart with public contribution data."
    : `Public GitHub contributions for the last 12 months: ${commas(stats.total)} contributions across ${commas(stats.activeDays)} active days.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="activityTitle activityDesc">
  <title id="activityTitle">Public activity log for @${displayHandle}</title>
  <desc id="activityDesc">${escapeXml(description)}</desc>
  <defs>
    <linearGradient id="googleH" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4285F4"/>
      <stop offset="34%" stop-color="#EA4335"/>
      <stop offset="67%" stop-color="#FBBC05"/>
      <stop offset="100%" stop-color="#34A853"/>
    </linearGradient>
    <linearGradient id="googleV" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4285F4"/>
      <stop offset="34%" stop-color="#EA4335"/>
      <stop offset="67%" stop-color="#FBBC05"/>
      <stop offset="100%" stop-color="#34A853"/>
    </linearGradient>
    <pattern id="paperDots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="0.9" fill="${COLOR.ink}" opacity="0.10"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="${COLOR.paper}"/>
  <rect width="${W}" height="${H}" fill="url(#paperDots)"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${COLOR.ink}" stroke-width="1"/>

  <!-- black masthead -->
  <rect x="0" y="0" width="${W}" height="58" fill="${COLOR.band}"/>
  <rect x="0" y="0" width="8" height="${H}" fill="url(#googleV)"/>
  <rect x="7.5" y="0" width="0.8" height="${H}" fill="${COLOR.ink}"/>
  ${Array.from({ length: 10 }, (_, i) => `<line x1="0" y1="${26 + i * 36}" x2="8" y2="${26 + i * 36}" stroke="${COLOR.ink}" stroke-width="0.8" opacity="${i % 3 === 0 ? 0.6 : 0.25}"/>`).join("")}
  <rect x="64" y="25" width="9" height="9" fill="url(#googleH)"/>
  <text x="86" y="34" font-family="${MONO}" font-size="10.5" letter-spacing="2.2" fill="${COLOR.paper}">PUBLIC ACTIVITY / CONTRIBUTION LOG</text>
  <text x="1136" y="34" text-anchor="end" font-family="${MONO}" font-size="9.4" letter-spacing="1.8" fill="${COLOR.paper}" opacity="0.55">@${displayHandle} / 12M</text>
  <text x="64" y="82" font-family="${MONO}" font-size="8.4" letter-spacing="1.6" fill="${COLOR.muted}">PUBLIC CONTRIBUTIONS / LAST 12 MONTHS</text>

  ${monthLabels.join("")}
  ${weekdayLabels}
  <g shape-rendering="crispEdges">${cells}</g>

  <line x1="930" y1="96" x2="930" y2="292" stroke="${COLOR.ink}" stroke-width="0.8" opacity="0.24"/>
  <text x="954" y="104" font-family="${MONO}" font-size="8.6" letter-spacing="1.6" fill="${COLOR.muted}">TOTAL / 12M</text>
  <text x="952" y="160" font-family="${DISPLAY}" font-size="${totalSize}" letter-spacing="-1" fill="${COLOR.ink}">${totalText}</text>
  <rect x="954" y="174" width="56" height="5" fill="url(#googleH)" stroke="${COLOR.ink}" stroke-width="0.8"/>
  ${statRows}

  <!-- a small wireframe depth mark -->
  <g transform="translate(1090 96)" stroke="${COLOR.ink}" fill="none" opacity="0.35">
    <path d="M 0 0 L 20 -11 L 40 0 L 20 11 Z"/>
    <path d="M 0 0 L 0 22 L 20 33 L 20 11"/>
    <path d="M 40 0 L 40 22 L 20 33"/>
    <path d="M 0 22 L 20 11 L 40 22" stroke-dasharray="2 3"/>
  </g>

  <line x1="64" y1="300" x2="1136" y2="300" stroke="${COLOR.ink}" stroke-width="0.8" opacity="0.22"/>
  <text x="64" y="328" font-family="${MONO}" font-size="8.2" letter-spacing="0.8" fill="${COLOR.dim}">LESS</text>
  ${legend}
  <text x="${100 + 5 * 17 + 8}" y="328" font-family="${MONO}" font-size="8.2" letter-spacing="0.8" fill="${COLOR.dim}">MORE</text>
  <text x="302" y="328" font-family="${MONO}" font-size="8.4" letter-spacing="1.4" fill="${COLOR.muted}">PUBLIC CONTRIBUTIONS / AUTO-GENERATED DAILY</text>
  <text x="1136" y="328" text-anchor="end" font-family="${MONO}" font-size="8.4" letter-spacing="1.1" fill="${COLOR.dim}"><tspan fill="${statusDot}" stroke="${COLOR.ink}" stroke-width="0.4">●</tspan> ${status}</text>
</svg>
`;
}

if (!placeholder && !login) {
  throw new Error("Provide a GitHub handle: node scripts/render-contributions.mjs <handle>");
}
if (!placeholder && !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) {
  throw new Error(`"${login}" does not look like a GitHub handle.`);
}

const localJson = process.env.CONTRIBUTION_JSON;
const data = placeholder ? placeholderData() : localJson ? await readContributionJson(localJson) : await fetchContributions(login);
const handle = placeholder ? login || "YOUR-HANDLE" : login;
const svg = render(data, handle);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, svg, "utf8");
console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${data.length} days${placeholder ? ", placeholder" : `, @${login}`}).`);
