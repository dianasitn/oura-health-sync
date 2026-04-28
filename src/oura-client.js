const axios = require('axios');
const dayjs = require('dayjs');

const BASE_URL = 'https://api.ouraring.com/v2/usercollection';

class OuraClient {
  constructor(token) {
    this.token = token;
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  async fetchAll(startDate, endDate) {
    const start = startDate || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const end = endDate || dayjs().format('YYYY-MM-DD');

    console.log(`[Oura] Fetching all data: ${start} → ${end}`);

    const results = {};
    const endpoints = [
      { key: 'daily_sleep',       path: '/daily_sleep',       params: { start_date: start, end_date: end } },
      { key: 'sleep',             path: '/sleep',             params: { start_date: start, end_date: end } },
      { key: 'daily_readiness',   path: '/daily_readiness',   params: { start_date: start, end_date: end } },
      { key: 'daily_activity',    path: '/daily_activity',    params: { start_date: start, end_date: end } },
      { key: 'daily_stress',      path: '/daily_stress',      params: { start_date: start, end_date: end } },
      { key: 'daily_resilience',  path: '/daily_resilience',  params: { start_date: start, end_date: end } },
      { key: 'daily_cardiovascular_age', path: '/daily_cardiovascular_age', params: { start_date: start, end_date: end } },
      { key: 'daily_spo2',        path: '/daily_spo2',        params: { start_date: start, end_date: end } },
      { key: 'sleep_time',        path: '/sleep_time',        params: { start_date: start, end_date: end } },
      { key: 'heart_rate',        path: '/heartrate',         params: { start_datetime: `${start}T00:00:00+00:00`, end_datetime: `${end}T23:59:59+00:00` } },
      { key: 'workout',           path: '/workout',           params: { start_date: start, end_date: end } },
      { key: 'tag',               path: '/tag',               params: { start_date: start, end_date: end } },
      { key: 'enhanced_tag',      path: '/enhanced_tag',      params: { start_date: start, end_date: end } },
      { key: 'vo2_max',           path: '/vO2_max',           params: { start_date: start, end_date: end } },
      { key: 'ring_configuration',path: '/ring_configuration',params: {} },
      { key: 'personal_info',     path: '/personal_info',     params: {} },
    ];

    for (const ep of endpoints) {
      try {
        const resp = await this.http.get(ep.path, { params: ep.params });
        results[ep.key] = resp.data.data || resp.data;
        const count = Array.isArray(results[ep.key]) ? results[ep.key].length : 1;
        console.log(`  ✓ ${ep.key}: ${count} record(s)`);
      } catch (err) {
        if (err.response?.status === 404 || err.response?.status === 422) {
          console.log(`  - ${ep.key}: not available for this account`);
          results[ep.key] = [];
        } else {
          console.error(`  ✗ ${ep.key}: ${err.message}`);
          results[ep.key] = [];
        }
      }
      // Respect rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }

  // Fetch last N days for historical backfill
  async fetchHistorical(days = 30) {
    const start = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    const end = dayjs().format('YYYY-MM-DD');
    return this.fetchAll(start, end);
  }
}

module.exports = OuraClient;
