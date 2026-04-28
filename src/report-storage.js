const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');

function ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function save(report) {
  ensureDir();
  const file = path.join(REPORTS_DIR, `${report.date}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`[Storage] Saved report → ${file}`);
}

function load(date) {
  const file = path.join(REPORTS_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listAll() {
  ensureDir();
  return fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8'));
      return {
        date: content.date,
        overall_status: content.overall_status,
        overall_emoji: content.overall_emoji,
        headline: content.headline,
        scores: content.scores,
        generated_at: content.generated_at
      };
    });
}

function loadLatest(n = 7) {
  ensureDir();
  return fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, n)
    .map(f => JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8')));
}

module.exports = { save, load, listAll, loadLatest };
