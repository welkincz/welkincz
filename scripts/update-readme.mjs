// Fills the <!-- recent --> block in README.md from public push events.
//
// Deliberately not a third-party action: this runs with a token on the
// account, and a script that can be read in one sitting is a smaller
// surface than a dependency that could change under us.
//
// Note: PushEvent payloads no longer carry a commits array, so the subject
// line is fetched from the head SHA. A repo that has since gone private
// just degrades to a bare name and date.

import { readFile, writeFile } from "node:fs/promises";

const USER = "welkincz";
const LIMIT = 5;
const START = "<!-- recent starts -->";
const END = "<!-- recent ends -->";

const headers = { accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) {
  headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const events = await api(`/users/${USER}/events/public?per_page=100`);

const seen = new Set();
const picks = [];
for (const ev of events) {
  if (ev.type !== "PushEvent" || seen.has(ev.repo.name)) continue;
  if (!ev.payload?.head) continue;
  seen.add(ev.repo.name);
  picks.push({ repo: ev.repo.name, sha: ev.payload.head, at: ev.created_at });
  if (picks.length === LIMIT) break;
}

const subjects = await Promise.all(
  picks.map((p) =>
    api(`/repos/${p.repo}/commits/${p.sha}`)
      .then((c) => c.commit.message.split("\n")[0])
      .catch(() => null),
  ),
);

const lines = picks.map((p, i) => {
  const name = p.repo.split("/")[1];
  const when = new Date(p.at).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto",
  });
  const link = `[${name}](https://github.com/${p.repo})`;
  return subjects[i]
    ? `${link} — ${subjects[i]} *(${when})*  `
    : `${link} *(${when})*  `;
});

const body = lines.length ? lines.join("\n") : "*Nothing public lately.*";

const readme = await readFile("README.md", "utf8");
const before = readme.indexOf(START);
const after = readme.indexOf(END);
if (before === -1 || after === -1) throw new Error("markers missing");

const next =
  readme.slice(0, before + START.length) + "\n" + body + "\n" + readme.slice(after);

if (next === readme) {
  console.log("no change");
} else {
  await writeFile("README.md", next);
  console.log(`updated with ${lines.length} entries`);
}
