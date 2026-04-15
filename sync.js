const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const DATA_URL = "https://data.gov.tw/dataset/14718";
const REPO_BASE = "https://cdn.jsdelivr.net/gh/bearathome/taiwan-holiday-json@latest";

async function fetchPage() {
  const res = await fetch(DATA_URL);
  return res.text();
}

function parseDownloadLinks(html) {
  const $ = cheerio.load(html);
  const links = [];

  $("a[href*='.csv']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `https://data.gov.tw${href}`;
    const nameParam = new URL(url).searchParams.get("name");
    const name = nameParam ? decodeURIComponent(nameParam) : $(el).text().trim();
    links.push({ name, url });
  });

  return links;
}

function filterLinks(links) {
  const pattern = /(\d+)年?.*政府.*機關辦公日曆表/;

  const matched = links.filter(
    (l) => pattern.test(l.name) && !l.name.includes("Google")
  );

  // Group by ROC year, take last entry per year (most updated)
  const byYear = new Map();
  for (const link of matched) {
    const m = link.name.match(/(\d+)/);
    if (m) {
      const rocYear = parseInt(m[1]);
      byYear.set(rocYear, link);
    }
  }

  return byYear;
}

async function fetchCsv(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) {
    text = new TextDecoder("big5").decode(buf);
  }
  return text;
}

function csvToHolidayMap(csvText) {
  const lines = csvText.trim().split("\n");
  const map = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 4) continue;

    const date = cols[0].trim();
    const status = cols[2].trim();
    const note = cols[3].trim();

    if (status === "2" && note) {
      map[date] = note;
    }
  }

  return map;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFeedItems(manifest) {
  const years = Object.keys(manifest)
    .map(Number)
    .sort((a, b) => b - a);

  return years.map((year) => {
    const entry = manifest[year];
    return {
      year,
      title: `${year} 台灣國定假日資料`,
      link: `${REPO_BASE}/${year}.json`,
      source: entry.source,
      updated: entry.updated,
    };
  });
}

function generateRss(items) {
  const now = new Date().toUTCString();
  const itemsXml = items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid>${escapeXml(item.link)}</guid>
      <description>${escapeXml(`資料來源: ${item.source}`)}</description>
      <pubDate>${new Date(item.updated).toUTCString()}</pubDate>
    </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>台灣國定假日資料</title>
    <link>https://github.com/bearathome/taiwan-holiday-json</link>
    <description>台灣每年國定假日 JSON 資料更新</description>
    <lastBuildDate>${now}</lastBuildDate>
${itemsXml}
  </channel>
</rss>
`;
}

function generateAtom(items) {
  const now = new Date().toISOString();
  const entriesXml = items
    .map(
      (item) => `  <entry>
    <title>${escapeXml(item.title)}</title>
    <link href="${escapeXml(item.link)}" />
    <id>${escapeXml(item.link)}</id>
    <summary>${escapeXml(`資料來源: ${item.source}`)}</summary>
    <updated>${new Date(item.updated).toISOString()}</updated>
  </entry>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>台灣國定假日資料</title>
  <link href="https://github.com/bearathome/taiwan-holiday-json" />
  <link href="${REPO_BASE}/feed.atom" rel="self" />
  <id>https://github.com/bearathome/taiwan-holiday-json</id>
  <updated>${now}</updated>
${entriesXml}
</feed>
`;
}

function generateJsonFeed(items) {
  return JSON.stringify(
    {
      version: "https://jsonfeed.org/version/1.1",
      title: "台灣國定假日資料",
      home_page_url: "https://github.com/bearathome/taiwan-holiday-json",
      feed_url: `${REPO_BASE}/feed.json`,
      items: items.map((item) => ({
        id: item.link,
        title: item.title,
        url: item.link,
        content_text: `資料來源: ${item.source}`,
        date_modified: new Date(item.updated).toISOString(),
      })),
    },
    null,
    2
  ) + "\n";
}

async function main() {
  const resultDir = path.join(__dirname, "result");
  fs.mkdirSync(resultDir, { recursive: true });

  // Load existing manifest
  const manifestPath = path.join(resultDir, "manifest.json");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  }

  console.log("Fetching page...");
  const html = await fetchPage();

  const links = parseDownloadLinks(html);
  console.log(`Found ${links.length} CSV links`);

  const byYear = filterLinks(links);
  console.log(`Matched ${byYear.size} years`);

  let updated = false;

  for (const [rocYear, link] of byYear) {
    const westYear = rocYear + 1911;
    const existing = manifest[westYear];

    if (existing && existing.source === link.name) {
      console.log(`Skipping ${rocYear}年 (${westYear}) - unchanged`);
      continue;
    }

    console.log(`Processing ${rocYear}年 (${westYear}) - ${link.name}`);

    const csv = await fetchCsv(link.url);
    const map = csvToHolidayMap(csv);

    const outPath = path.join(resultDir, `${westYear}.json`);
    fs.writeFileSync(outPath, JSON.stringify(map, null, 2) + "\n");
    console.log(`  -> ${outPath} (${Object.keys(map).length} holidays)`);

    manifest[westYear] = {
      source: link.name,
      updated: new Date().toISOString(),
    };
    updated = true;
  }

  // Save manifest
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // Generate feeds
  const items = buildFeedItems(manifest);
  fs.writeFileSync(path.join(resultDir, "feed.xml"), generateRss(items));
  fs.writeFileSync(path.join(resultDir, "feed.atom"), generateAtom(items));
  fs.writeFileSync(path.join(resultDir, "feed.json"), generateJsonFeed(items));
  console.log("Feeds generated");

  console.log(updated ? "Done! Data updated." : "Done! No changes.");
}

main().catch(console.error);
