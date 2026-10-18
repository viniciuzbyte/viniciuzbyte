import { mkdirSync, writeFileSync } from "node:fs";

const LOGIN = process.env.PROFILE_LOGIN ?? process.env.GITHUB_REPOSITORY_OWNER;
const TOKEN = process.env.GITHUB_TOKEN;
const OUTPUT = "assets/stats.svg";
const WIDTH = 860;
const INNER = WIDTH - 32;
const LEVEL_COLORS = ["#161b22", "#2d1b69", "#5b21b6", "#7F00FF", "#00DBDE"];

const QUERY = `
query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: { field: STARGAZERS, direction: DESC }) {
      totalCount
      nodes { stargazerCount primaryLanguage { name color } }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date weekday } }
      }
    }
  }
}`;

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

const format = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

const fetchProfile = async () => {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!response.ok) throw new Error(`GraphQL request failed with ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  if (!payload.data?.user) throw new Error(`User ${LOGIN} not found`);
  return payload.data.user;
};

const summarize = (user) => {
  const repos = user.repositories.nodes;
  const stars = repos.reduce((sum, repo) => sum + repo.stargazerCount, 0);
  const counts = new Map();
  for (const repo of repos) {
    const language = repo.primaryLanguage;
    if (!language) continue;
    const entry = counts.get(language.name) ?? { count: 0, color: language.color ?? "#8b949e" };
    entry.count += 1;
    counts.set(language.name, entry);
  }
  const total = [...counts.values()].reduce((sum, entry) => sum + entry.count, 0) || 1;
  const languages = [...counts.entries()]
    .map(([name, { count, color }]) => ({ name, color, share: count / total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);
  const collection = user.contributionsCollection;
  const weeks = collection.contributionCalendar.weeks;
  const days = weeks.flatMap((week) => week.contributionDays);
  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = day.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].contributionCount > 0) current += 1;
    else if (i === days.length - 1) continue;
    else break;
  }
  return {
    weeks,
    languages,
    stars,
    current,
    longest,
    followers: user.followers.totalCount,
    repositories: user.repositories.totalCount,
    commits: collection.totalCommitContributions,
    pullRequests: collection.totalPullRequestContributions,
    issues: collection.totalIssueContributions,
    reviews: collection.totalPullRequestReviewContributions,
    yearTotal: collection.contributionCalendar.totalContributions,
    maxDay: Math.max(1, ...days.map((day) => day.contributionCount)),
  };
};

const renderTiles = (data) => {
  const tiles = [
    ["COMMITS", data.commits],
    ["PULL REQUESTS", data.pullRequests],
    ["ISSUES", data.issues],
    ["REVIEWS", data.reviews],
    ["STARS", data.stars],
    ["FOLLOWERS", data.followers],
  ];
  const tileWidth = (INNER - 5 * 12) / 6;
  return tiles
    .map(([label, value], i) => {
      const x = 16 + i * (tileWidth + 12);
      return [
        `<g transform="translate(${x.toFixed(1)},60)">`,
        `<rect width="${tileWidth.toFixed(1)}" height="76" rx="10" fill="#161b22" stroke="#30363d"/>`,
        `<text x="${(tileWidth / 2).toFixed(1)}" y="34" text-anchor="middle" font-family="Courier New, monospace" font-size="26" font-weight="700" fill="url(#accent)">${format(value)}</text>`,
        `<text x="${(tileWidth / 2).toFixed(1)}" y="58" text-anchor="middle" font-family="Courier New, monospace" font-size="10" letter-spacing="1.5" fill="#8b949e">${label}</text>`,
        "</g>",
      ].join("");
    })
    .join("");
};

const renderLanguages = (data) => {
  if (data.languages.length === 0) return "";
  let cursor = 16;
  const segments = data.languages.map((language) => {
    const width = language.share * INNER;
    const rect = `<rect x="${cursor.toFixed(1)}" y="158" width="${width.toFixed(1)}" height="10" fill="${escapeXml(language.color)}"/>`;
    cursor += width;
    return rect;
  });
  let legendX = 16;
  const legend = data.languages.map((language) => {
    const item = `<circle cx="${legendX + 5}" cy="188" r="5" fill="${escapeXml(language.color)}"/><text x="${legendX + 16}" y="192" font-family="Courier New, monospace" font-size="12" fill="#c9d1d9">${escapeXml(language.name)} ${(language.share * 100).toFixed(0)}%</text>`;
    legendX += 24 + (language.name.length + 5) * 7.4;
    return item;
  });
  return `<clipPath id="bar"><rect x="16" y="158" width="${INNER}" height="10" rx="5"/></clipPath><g clip-path="url(#bar)">${segments.join("")}</g>${legend.join("")}`;
};

const level = (count, max) => (count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)));

const renderHeatmap = (data) => {
  const cell = 12;
  const step = 15;
  const offsetX = 16 + (INNER - data.weeks.length * step) / 2;
  return data.weeks
    .map((week, w) =>
      week.contributionDays
        .map((day) => {
          const x = offsetX + w * step;
          const y = 220 + day.weekday * step;
          return `<rect class="c" x="${x.toFixed(1)}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${LEVEL_COLORS[level(day.contributionCount, data.maxDay)]}" style="animation-delay:${w * 14}ms"><title>${day.date}: ${day.contributionCount}</title></rect>`;
        })
        .join("")
    )
    .join("");
};

const render = (data) =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="364" viewBox="0 0 ${WIDTH} 364" role="img" aria-label="GitHub stats for ${escapeXml(LOGIN)}">`,
    '<defs><linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#00DBDE"/><stop offset="1" stop-color="#FC00FF"/></linearGradient></defs>',
    "<style>.c{opacity:0;animation:fade .45s ease-out forwards}@keyframes fade{to{opacity:1}}</style>",
    `<rect width="${WIDTH}" height="364" rx="14" fill="#0d1117"/>`,
    `<rect x="1" y="1" width="${WIDTH - 2}" height="362" rx="13" fill="none" stroke="#30363d" stroke-width="2"/>`,
    `<text x="16" y="38" font-family="Courier New, monospace" font-size="20" font-weight="700" fill="url(#accent)">${escapeXml(LOGIN)} / stats</text>`,
    `<text x="${WIDTH - 16}" y="38" text-anchor="end" font-family="Courier New, monospace" font-size="12" fill="#8b949e">${data.repositories} repositories · last 12 months</text>`,
    renderTiles(data),
    renderLanguages(data),
    renderHeatmap(data),
    `<text x="16" y="352" font-family="Courier New, monospace" font-size="12" fill="#8b949e">Current streak <tspan fill="#00DBDE" font-weight="700">${data.current}d</tspan> · Longest <tspan fill="#FC00FF" font-weight="700">${data.longest}d</tspan> · <tspan fill="#c9d1d9" font-weight="700">${format(data.yearTotal)}</tspan> contributions</text>`,
    "</svg>",
  ].join("");

const main = async () => {
  if (!LOGIN || !TOKEN) {
    console.error("PROFILE_LOGIN and GITHUB_TOKEN are required");
    process.exit(1);
  }
  const data = summarize(await fetchProfile());
  mkdirSync("assets", { recursive: true });
  writeFileSync(OUTPUT, render(data));
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
