const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const DATA_URL = "https://data.gov.tw/dataset/14718";

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
    // Extract name from URL query param
    const nameParam = new URL(url).searchParams.get("name");
    const name = nameParam ? decodeURIComponent(nameParam) : $(el).text().trim();
    links.push({ name, url });
  });

  return links;
}

function filterLinks(links) {
  // Match pattern like "108年中華民國政府行政機關辦公日曆表"
  // Exclude entries containing "Google行事曆專用"
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

async function main() {
  const resultDir = path.join(__dirname, "result");
  fs.mkdirSync(resultDir, { recursive: true });

  console.log("Fetching page...");
  const html = await fetchPage();

  const links = parseDownloadLinks(html);
  console.log(`Found ${links.length} CSV links`);

  const byYear = filterLinks(links);
  console.log(`Matched ${byYear.size} years`);

  for (const [rocYear, link] of byYear) {
    const westYear = rocYear + 1911;
    console.log(`Processing ${rocYear}年 (${westYear}) - ${link.name}`);

    const csv = await fetchCsv(link.url);
    const map = csvToHolidayMap(csv);

    const outPath = path.join(resultDir, `${westYear}.json`);
    fs.writeFileSync(outPath, JSON.stringify(map, null, 2) + "\n");
    console.log(`  -> ${outPath} (${Object.keys(map).length} holidays)`);
  }

  console.log("Done!");
}

main().catch(console.error);
