const { GoogleGenerativeAI } = require('@google/generative-ai');
const dayjs = require('dayjs');

class ReportGenerator {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-1.5-flash - better free tier limits than 2.0
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
    return { date: d,
      sleep: { score: sleep.score, total_hours: sleepDet.total_sleep_duration ? +(sleepDet.total_sleep_duration/3600).toFixed(1) : null, avg_hrv: sleepDet.average_hrv, deep_sleep_min: sleepDet.deep_sleep_duration ? Math.round(sleepDet.deep_sleep_duration/60) : null, efficiency_pct: sleepDet.efficiency, lowest_hr: sleepDet.lowest_heart_rate },
      readiness: { score: readiness.score, temp_deviation: readiness.temperature_deviation },
      activity: { score: activity.score, steps: activity.steps, active_calories: activity.active_calories },
      stress: { stress_high_min: stress.stress_high ? Math.round(stress.stress_high/60) : null, summary: stress.day_summary },
      spo2: { avg_pct: spo2.spo2_percentage?.average },
      workouts: workouts.map(w => ({ activity: w.activity, duration_min: w.duration ? Math.round(w.duration/60) : null }))
    };
  }

  async generate(ouraData, date, previousDayData = null) {
    const ctx = this.buildContext(ouraData, date);
    const prompt = `Health data for ${ctx.date}. Return ONLY valid JSON in Russian.
Data: ${JSON.stringify(ctx)}
Required JSON: {date, overall_status(отлично/хорошо/удовлетворительно/плохо), overall_emoji(🟢/🟡/🟠/🔴), headline(max 80 chars in Russian), scores:{sleep,readiness,activity}, key_insights:[3 strings in Russian with numbers], sleep_summary(2 sentences in Russian), recovery_summary(2 sentences in Russian), activity_summary(2 sentences in Russian), recommendations:[3 strings in Russian], highlight_metric:{label,value,note}, concern_metric:{label,value,note}}`;
    const result = await this.model.generateContent(prompt);
    const text = result.response.text().replace(/```json|\n```|```/g,'').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const report = JSON.parse(match[0]);
    report.generated_at = new Date().toISOString();
    return report;
  }
}
module.exports = ReportGenerator;
