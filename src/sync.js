require('dotenv').config();
const dayjs = require('dayjs');
const OuraClient = require('./oura-client');
const InfluxWriter = require('./influx-writer');
const ReportGenerator = require('./report-generator');
const storage = require('./report-storage');

async function runSync(options = {}) {
  const { date = dayjs().subtract(1, 'day').format('YYYY-MM-DD'), historical = false, historicalDays = 30 } = options;
  console.log('\n=== Oura Health Sync | ' + new Date().toISOString() + ' ===');

  const oura = new OuraClient(process.env.OURA_TOKEN);
  let ouraData;
  if (historical) {
    console.log('Fetching ' + historicalDays + ' days historical...');
    ouraData = await oura.fetchHistorical(historicalDays);
  } else {
    ouraData = await oura.fetchAll(date, dayjs(date).add(1, 'day').format('YYYY-MM-DD'));
  }

  let influx = null;
  if (process.env.INFLUX_URL && process.env.INFLUX_TOKEN && process.env.INFLUX_TOKEN !== 'your_influxdb_token_here') {
    influx = new InfluxWriter({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN, org: process.env.INFLUX_ORG, bucket: process.env.INFLUX_BUCKET });
    const points = influx.writePoints(ouraData);
    await influx.flush(points);
  }

  if (process.env.GEMINI_API_KEY) {
    const generator = new ReportGenerator(process.env.GEMINI_API_KEY);
    if (historical) {
      const startDate = dayjs().subtract(historicalDays, 'day');
      for (let i = 0; i < historicalDays; i++) {
        const d = startDate.add(i, 'day').format('YYYY-MM-DD');
        if (storage.load(d)) { console.log('Skip ' + d); continue; }
        try {
          const report = await generator.generate(ouraData, d, null);
          storage.save(report);
          console.log(d + ': ' + report.overall_emoji + ' ' + report.headline);
        } catch(e) { console.error(d + ' failed:', e.message); }
        // Wait 10s between requests to respect Gemini free tier rate limits
        await new Promise(r => setTimeout(r, 10000));
      }
    } else {
      const report = await generator.generate(ouraData, date, null);
      storage.save(report);
      console.log('Report: ' + report.overall_emoji + ' ' + report.headline);
    }
  }

  if (influx) await influx.close();
  console.log('=== Sync complete ===');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const historical = args.includes('--historical');
  const days = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '30');
  const date = args.find(a => a.match(/^\d{4}-\d{2}-\d{2}$/));
  runSync({ date, historical, historicalDays: days }).catch(err => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = { runSync };
