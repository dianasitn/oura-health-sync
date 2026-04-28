const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const dayjs = require('dayjs');

class InfluxWriter {
  constructor({ url, token, org, bucket }) {
    this.client = new InfluxDB({ url, token });
    this.org = org;
    this.bucket = bucket;
    this.writeApi = this.client.getWriteApi(org, bucket, 'ns');
  }

  toTimestamp(dateStr) {
    return new Date(dateStr).getTime() * 1_000_000; // nanoseconds
  }

  writePoints(data) {
    const points = [];

    for (const d of (data.daily_sleep || [])) {
      const p = new Point('daily_sleep').timestamp(this.toTimestamp(d.day)).tag('source', 'oura');
      if (d.score != null) p.intField('score', d.score);
      if (d.contributors?.deep_sleep != null) p.intField('deep_sleep_score', d.contributors.deep_sleep);
      points.push(p);
    }
    for (const d of (data.sleep || [])) {
      if (!d.day) continue;
      const p = new Point('sleep_details').timestamp(this.toTimestamp(d.day)).tag('source', 'oura').tag('type', d.type || 'unknown');
      if (d.total_sleep_duration != null) p.intField('total_sleep_duration_sec', d.total_sleep_duration);
      if (d.deep_sleep_duration != null) p.intField('deep_sleep_sec', d.deep_sleep_duration);
      if (d.rem_sleep_duration != null) p.intField('rem_sleep_sec', d.rem_sleep_duration);
      if (d.average_hrv != null) p.floatField('avg_hrv', d.average_hrv);
      if (d.lowest_heart_rate != null) p.intField('lowest_hr_bpm', d.lowest_heart_rate);
      if (d.efficiency != null) p.intField('efficiency_pct', d.efficiency);
      points.push(p);
    }
    for (const d of (data.daily_readiness || [])) {
      const p = new Point('daily_readiness').timestamp(this.toTimestamp(d.day)).tag('source', 'oura');
      if (d.score != null) p.intField('score', d.score);
      if (d.temperature_deviation != null) p.floatField('temperature_deviation', d.temperature_deviation);
      if (d.contributors?.hrv_balance != null) p.intField('hrv_balance', d.contributors.hrv_balance);
      points.push(p);
    }
    for (const d of (data.daily_activity || [])) {
      const p = new Point('daily_activity').timestamp(this.toTimestamp(d.day)).tag('source', 'oura');
      if (d.score != null) p.intField('score', d.score);
      if (d.steps != null) p.intField('steps', d.steps);
      if (d.active_calories != null) p.intField('active_calories_kcal', d.active_calories);
      points.push(p);
    }
    for (const d of (data.daily_stress || [])) {
      const p = new Point('daily_stress').timestamp(this.toTimestamp(d.day)).tag('source', 'oura');
      if (d.stress_high != null) p.intField('stress_high_sec', d.stress_high);
      points.push(p);
    }
    for (const d of (data.daily_spo2 || [])) {
      const p = new Point('daily_spo2').timestamp(this.toTimestamp(d.day)).tag('source', 'oura');
      if (d.spo2_percentage?.average != null) p.floatField('avg_spo2_pct', d.spo2_percentage.average);
      points.push(p);
    }
    for (const d of (data.heart_rate || [])) {
      if (!d.timestamp || d.bpm == null) continue;
      const p = new Point('heart_rate').timestamp(new Date(d.timestamp).getTime() * 1_000_000).tag('source', 'oura').intField('bpm', d.bpm);
      points.push(p);
    }
    for (const d of (data.workout || [])) {
      if (!d.day) continue;
      const p = new Point('workout').timestamp(this.toTimestamp(d.day)).tag('source', 'oura').tag('activity', d.activity || 'unknown');
      if (d.duration != null) p.intField('duration_sec', d.duration);
      points.push(p);
    }
    return points;
  }
  async flush(points) {
    if (!points.length) return;
    this.writeApi.writePoints(points);
    await this.writeApi.flush();
    console.log(`[InfluxDB] ✓ Written ${points.length} points`);
  }
  async close() { await this.writeApi.close(); }
}
module.exports = InfluxWriter;
