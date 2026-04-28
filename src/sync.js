require('dotenv').config();
const dayjs = require('dayjs');
const OuraClient = require('./oura-client');
const InfluxWriter = require('./influx-writer');
const ReportGenerator = require('./report-generator');
const storage = require('./report-storage');

async function runSync(options = {}) {
  const { date = dayjs().subtract(1, 'day').format('YYYY-MM-DD'), historical = false, historicalDays = 14 } = options;

  console.log('\n=== Oura Health Sync | ' + new Date().toISOString() + ' ===');

  const oura = new OuraClient(process.env.OURA_TOKEN);
  let ouraData;

  if (historical) {
    console.log('Fetching ' + historicalDays + ' days of historical data...');
    ouraData = await oura.fetchHistorical(historicalDays);
  } else {
    console.log('Fetching data for ' + date + '...');
    ouraData = await oura.fetchAll(date, dayjs(date).add(1, 'day').format('YYYY-MM-DD'));
  }

  // Write to InfluxDB - catch errors so AI reports still run
  if (process.env.INFLUX_URL && process.env.INFLUX_TOKEN && process.env.INFLUX_TOKEN !== 'your_influxdb_token_here') {
    try {
      console.log('Writing to InfluxDB...');
      const influx = new InfluxWriter({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN, org: process.env.INFLUX_ORG, bucket: process.env.INFLUX_BUCKET });
      const points = influx.writePoints(ouraData);
      await influx.flush(points);
      await influx.close();
    } catch (err) {
      console.error('InfluxDB error (continuing):', err.message);
    }
  }

  // Generate AI reports - always run this
  const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey !== 'your_gemini_key_here' && apiKey !== 'your_anthropic_key_here') {
    console.log('Generating AI reports...');
    const generator = new ReportGenerator(apiKey);

    if (historical) {
      const startDate = dayjs().subtract(historicalDays, 'day');
      for (let i = 0; i < historicalDays; i++) {
        const d = startDate.add(i, 'day').format('YYYY-MM-DD');
        if (storage.load(d)) { console.log('  Skip ' + d + ' (exists)'); continue; }
        try {
          const report = await generator.generate(ouraData, d, null);
          storage.save(report);
          console.log('  Report ' + d + ': ' + report.overall_emoji + ' ' + report.headline);
        } catch(e) { console.error('  Report ' + d + ' failed:', e.message); }
        await new Promise(r => setTimeout(r, 1500));
      }
    } else {
      try {
        const prevDate = dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');
        const prevData = await oura.fetchAll(prevDate, date).catch(() => null);
        const report = await generator.generate(ouraData, date, prevData);
        storage.save(report);
        console.log('Report: ' + report.overall_emoji + ' ' + report.headline);
      } catch(e) { console.error('Report failed:', e.message); }
    }
  } else {
    console.log('No AI key configured - skipping reports');
  }

  console.log('=== Sync complete! ===');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const historical = args.includes('--historical');
  const days = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '14');
  const date = args.find(a => a.match(/^\d{4}-\d{2}-\d{2}$/));
  runSync({ date, historical, historicalDays: days }).catch(err => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = { runSync };
