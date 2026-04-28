require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const dayjs = require('dayjs');
const { runSync } = require('./sync');
const storage = require('./report-storage');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => { res.json({ status: 'ok', time: new Date().toISOString() }); });

app.get('/api/reports', (req, res) => {
  try { const reports = storage.listAll(); res.json({ reports, count: reports.length }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/:date', (req, res) => {
  const report = storage.load(req.params.date);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
});

app.get('/api/reports/latest/:n', (req, res) => {
  const n = parseInt(req.params.n) || 7;
  const reports = storage.loadLatest(n);
  res.json({ reports, count: reports.length });
});

app.get('/api/trends', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const reports = storage.loadLatest(days);
  const trends = { dates: [], sleep_scores: [], readiness_scores: [], activity_scores: [] };
  reports.reverse().forEach(r => {
    trends.dates.push(r.date);
    trends.sleep_scores.push(r.scores?.sleep ?? null);
    trends.readiness_scores.push(r.scores?.readiness ?? null);
    trends.activity_scores.push(r.scores?.activity ?? null);
  });
  res.json(trends);
});

app.post('/api/sync', async (req, res) => {
  const { date, historical, days } = req.body || {};
  res.json({ message: 'Sync started', date: date || 'yesterday' });
  runSync({ date, historical, historicalDays: days || 30 }).catch(err => console.error('Manual sync error:', err));
});

const schedule = process.env.CRON_SCHEDULE || '0 8 * * *';
cron.schedule(schedule, async () => {
  try { await runSync({}); } catch (err) { console.error('Cron sync error:', err); }
}, { timezone: 'UTC' });

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚠 Oura Health Sync API running on port ${PORT}`);
});
