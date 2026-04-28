const { GoogleGenerativeAI } = require('@google/generative-ai');
const dayjs = require('dayjs');

class ReportGenerator {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  buildContext(ouraData, date) {
    const d = date || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const sleep     = (ouraData.daily_sleep || []).find(x => x.day === d) || {};
    const sleepDet  = (ouraData.sleep || []).find(x => x.day === d) || {};
    const readiness = (ouraData.daily_readiness || []).find(x => x.day === d) || {};
    const activity  = (ouraData.daily_activity || []).find(x => x.day === d) || {};
    const stress    = (ouraData.daily_stress || []).find(x => x.day === d) || {};
    const spo2      = (ouraData.daily_spo2 || []).find(x => x.day === d) || {};
    const workouts  = (ouraData.workout || []).filter(x => x.day === d);
    return {
      date: d,
      sleep: { score: sleep.score, total_hours: sleepDet.total_sleep_duration ? +(sleepDet.total_sleep_duration/3600).toFixed(1) : null, avg_hrv: sleepDet.average_hrv, deep_sleep_min: sleepDet.deep_sleep_duration ? Math.round(sleepDet.deep_sleep_duration/60) : null, rem_sleep_min: sleepDet.rem_sleep_duration ? Math.round(sleepDet.rem_sleep_duration/60) : null, efficiency_pct: sleepDet.efficiency, lowest_hr: sleepDet.lowest_heart_rate },
      readiness: { score: readiness.score, temp_deviation: readiness.temperature_deviation, contributors: readiness.contributors || {} },
      activity: { score: activity.score, steps: activity.steps, active_calories: activity.active_calories, high_activity_min: activity.high_activity_time ? Math.round(activity.high_activity_time/60) : null },
      stress: { stress_high_min: stress.stress_high ? Math.round(stress.stress_high/60) : null, recovery_high_min: stress.recovery_high ? Math.round(stress.recovery_high/60) : null, summary: stress.day_summary },
      spo2: { avg_pct: spo2.spo2_percentage?.average },
      workouts: workouts.map(w => ({ activity: w.activity, duration_min: w.duration ? Math.round(w.duration/60) : null }))
    };
  }

  async generate(ouraData, date, previousDayData = null) {
    const ctx = this.buildContext(ouraData, date);
    const prev = previousDayData ? this.buildContext(previousDayData, dayjs(date).subtract(1, 'day').format('YYYY-MM-DD')) : null;
    const prompt = `Analyze Oura Ring data for ${ctx.date}. Return ONLY valid JSON health report in Russian.
DATA: ${JSON.stringify(ctx)}
${prev ? 'PREV: ' + JSON.stringify(prev) : ''}
JSON fields: date, overall_status(отлично/хорошо/удовлетворительно/плохо), overall_emoji(🟢/🟡/🟠/🔴), headline(max 80 chars), scores{sleep,readiness,activity}, key_insights[3 strings with numbers], sleep_summary, recovery_summary, activity_summary, stress_recovery_balance, recommendations[3], compared_to_yesterday, highlight_metric{label,value,note}, concern_metric{label,value,note}`;
    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text().trim().replace(/```json|\n```|```/g, '');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      const report = JSON.parse(match[0]);
      report.generated_at = new Date().toISOString();
      return report;
    } catch(err) {
      console.error('[Gemini] Error:', err.message);
      return { date: ctx.date, overall_status: 'unknown', overall_emoji: '⚪', headline: 'Данные получены', scores: {}, key_insights: [], error: err.message, generated_at: new Date().toISOString() };
    }
  }
}
module.exports = ReportGenerator;
