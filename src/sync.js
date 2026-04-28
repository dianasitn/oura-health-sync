require('dotenv').config();
const dayjs = require('dayjs');
const OuraClient = require('./oura-client');
const InfluxWriter = require('./influx-writer');
const ReportGenerator = require('./report-generator');
const storage = require('./report-storage');

async function runSync(options = {}) {
  const {
    date = dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
    historical = false,
    historicalDays = 30
  } = options;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`🔄  Oura Health Sync  |  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════\n');

  const oura = new OuraClient(process.env.OURA_TOKEN);
  let ouraData;

  if (historical) {
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

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_key_here') {
    const generator = new ReportGenerator(process.env.ANTHROPIC_API_KEY);
    if (historical) {
      const startDate = dayjs().subtract(historicalDays, 'day');
      for (let i = 0; i < historicalDays; i++) {
        const d = startDate.add(i, 'day').format('YYYY-MM-DD');
        if (storage.load(d)) continue;
        const report = await generator.generate(ouraData, d, null);
        storage.save(report);
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      const prevDate = dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');
      const prevData = await oura.fetchAll(prevDate, date).catch(() => null);
      const report = await generator.generate(ouraData, date, prevData);
      storage.save(report);
    }
  }

  if (influx) await influx.close();
  console.log('\n✅ Sync complete!\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const historical = args.includes('--historical');
  const days = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '30');
  const date = args.find(a => a.match(/^\d{4}-\d{2}-\d{2}$/));
  runSync({ date, historical, historicalDays: days }).catch(err => { console.error('Fatal error:', err); process.exit(1); });
}

module.exports = { runSync };
