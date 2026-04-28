const Anthropic = require('@anthropic-ai/sdk');
const dayjs = require('dayjs');

class ReportGenerator {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  buildContext(ouraData, date) {
    const d = date || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const sleep    = (ouraData.daily_sleep || []).find(x => x.day === d) || {};
    const sleepDet = (ouraData.sleep || []).find(x => x.day === d) || {};
    const readiness= (ouraData.daily_readiness || []).find(x => x.day === d) || {};
    const activity = (ouraData.daily_activity || []).find(x => x.day === d) || {};
    const stress   = (ouraData.daily_stress || []).find(x => x.day === d) || {};
    const spo2     = (ouraData.daily_spo2 || []).find(x => x.day === d) || {};
    const workouts = (ouraData.workout || []).filter(x => x.day === d);
    return { date: d, sleep: { score: sleep.score, total_hours: sleepDet.total_sleep_duration ? +(sleepDet.total_sleep_duration/3600).toFixed(1) : null, avg_hrv: sleepDet.average_hrv }, readiness: { score: readiness.score }, activity: { score: activity.score, steps: activity.steps }, stress: { summary: stress.day_summary }, spo2: { avg_pct: spo2.spo2_percentage?.average }, workouts: workouts.map(w => ({ activity: w.activity, duration_min: w.duration ? Math.round(w.duration/60) : null })) };
  }

  async generate(ouraData, date, previousDayData = null) {
    const ctx = this.buildContext(ouraData, date);
    const prev = previousDayData ? this.buildContext(previousDayData, dayjs(date).subtract(1, 'day').format('YYYY-MM-DD')) : null;
    const prompt = `Analyze Oura data for ${ctx.date} and return JSON report in Russian:\n${JSON.stringify(ctx, null,2)}\nReturn ONLY JSON with: date, overall_status, overall_emoji, headline, scores, key_insights, sleep_summary, recovery_summary, activity_summary, recommendations, compared_to_yesterday, highlight_metric, concern_metric`;
    try {
      const response = await this.client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
      const text = response.content[0].text.trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      const report = JSON.parse(match[0]);
      report.generated_at = new Date().toISOString();
      return report;
    } catch(err) {
      return { date: ctx.date, overall_status: 'unknown', overall_emoji: '⚪', headline: 'Данные получены, отчёт временно недоступен', scores: {}, key_insights: [], error: err.message, generated_at: new Date().toISOString() };
    }
  }
}
module.exports = ReportGenerator;
