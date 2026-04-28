require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const dayjs = require('dayjs');
const axios = require('axios');
const storage = require('./report-storage');

const app = express();
app.use(cors());
app.use(express.json());

const OURA_TOKEN = process.env.OURA_TOKEN;
const BASE = 'https://api.ouraring.com/v2/usercollection';

async function fetchOura(path, params) {
  const r = await axios.get(BASE + path, {
    headers: { Authorization: 'Bearer ' + OURA_TOKEN },
    params
  });
  return r.data.data || r.data;
}

function scoreColor(s) {
  if (!s) return 'grey';
  if (s >= 85) return 'отлично';
  if (s >= 70) return 'хорошо';
  if (s >= 50) return 'удовлетворительно';
  return 'плохо';
}

function scoreEmoji(s) {
  if (!s) return '⚪';
  if (s >= 85) return '🟢';
  if (s >= 70) return '🟡';
  if (s >= 50) return '🟠';
  return '🔴';
}

async function buildReport(date) {
  const start = date;
  const end = dayjs(date).add(1,'day').format('YYYY-MM-DD');
  
  const [sleepArr, readArr, actArr, stressArr, spo2Arr] = await Promise.allSettled([
    fetchOura('/daily_sleep', {start_date:start, end_date:end}),
    fetchOura('/daily_readiness', {start_date:start, end_date:end}),
    fetchOura('/daily_activity', {start_date:start, end_date:end}),
    fetchOura('/daily_stress', {start_date:start, end_date:end}),
    fetchOura('/daily_spo2', {start_date:start, end_date:end}),
  ]);

  const sleep = sleepArr.status==='fulfilled' ? (sleepArr.value||[]).find(x=>x.day===date)||{} : {};
  const read  = readArr.status==='fulfilled'  ? (readArr.value||[]).find(x=>x.day===date)||{}  : {};
  const act   = actArr.status==='fulfilled'   ? (actArr.value||[]).find(x=>x.day===date)||{}   : {};
  const stress= stressArr.status==='fulfilled'? (stressArr.value||[]).find(x=>x.day===date)||{}: {};
  const spo2  = spo2Arr.status==='fulfilled'  ? (spo2Arr.value||[]).find(x=>x.day===date)||{}  : {};

  const sleepScore = sleep.score;
  const readScore  = read.score;
  const actScore   = act.score;
  const avgScore   = [sleepScore, readScore, actScore].filter(Boolean).reduce((a,b)=>a+b,0) / 
                     [sleepScore, readScore, actScore].filter(Boolean).length || 0;
  
  const status = scoreColor(Math.round(avgScore));
  const emoji  = scoreEmoji(Math.round(avgScore));

  // Build insights from real data
  const insights = [];
  if (sleepScore) insights.push('Сон: ' + sleepScore + ' баллов — ' + scoreColor(sleepScore));
  if (readScore)  insights.push('Готовность: ' + readScore + ' баллов — ' + scoreColor(readScore));
  if (actScore)   insights.push('Активность: ' + actScore + ' баллов — ' + scoreColor(actScore));
  if (act.steps)  insights.push('Шагов сделано: ' + act.steps);
  if (sleep.contributors?.hrv_balance) insights.push('HRV баланс: ' + sleep.contributors.hrv_balance);
  if (spo2.spo2_percentage?.average)   insights.push('SpO2: ' + spo2.spo2_percentage.average.toFixed(1) + '%');
  
  const headline = sleepScore && readScore
    ? 'Сон ' + sleepScore + ' · Готовность ' + readScore + ' · Активность ' + (actScore||'—')
    : 'Данные за ' + date;

  const recs = [];
  if (sleepScore && sleepScore < 70) recs.push('Лечь спать раньше обычного на 30–60 минут');
  if (readScore && readScore < 70)   recs.push('Снизить интенсивность тренировок сегодня');
  if (actScore && actScore < 70)     recs.push('Добавить 20-минутную прогулку');
  if (recs.length === 0) recs.push('Поддерживай текущий режим — показатели хорошие', 'Гидратация: выпить 2л воды сегодня', 'Вечером — 10 минут растяжки');

  return {
    date,
    overall_status: status,
    overall_emoji: emoji,
    headline,
    scores: { sleep: sleepScore||null, readiness: readScore||null, activity: actScore||null },
    key_insights: insights.slice(0,5),
    sleep_summary: sleepScore ? 'Оценка сна: ' + sleepScore + ' (' + scoreColor(sleepScore) + '). ' + (sleep.contributors ? 'Готовность после сна: ' + (sleep.contributors.previous_night||'—') : '') : 'Данные о сне не получены.',
    recovery_summary: readScore ? 'Индекс готовности: ' + readScore + '. ' + (read.temperature_deviation ? 'Отклонение температуры: ' + read.temperature_deviation.toFixed(2) + '°C.' : '') : 'Данные о восстановлении не получены.',
    activity_summary: actScore ? 'Активность: ' + actScore + ' баллов. Шагов: ' + (act.steps||'—') + '. Калорий сожжено: ' + (act.active_calories||'—') : 'Данные об активности не получены.',
    stress_recovery_balance: stress.day_summary || (stress.stress_high ? 'Стресс: ' + Math.round(stress.stress_high/60) + ' мин, Восстановление: ' + Math.round((stress.recovery_high||0)/60) + ' мин' : 'Данные о стрессе не получены.'),
    recommendations: recs,
    compared_to_yesterday: 'Нет данных для сравнения',
    highlight_metric: sleepScore ? {label:'Сон', value: sleepScore + ' баллов', note: scoreColor(sleepScore)} : {label:'—',value:'—',note:'—'},
    concern_metric: (readScore && readScore < 70) ? {label:'Готовность', value: readScore + ' баллов', note:'Рекомендован отдых'} : {label:'—',value:'—',note:'Всё в норме'},
    generated_at: new Date().toISOString(),
    source: 'rule-based'
  };
}

app.get('/health', (req, res) => res.json({status:'ok', time:new Date().toISOString()}));

app.get('/api/reports', (req, res) => {
  try { const r = storage.listAll(); res.json({reports:r, count:r.length}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/reports/latest/:n', (req, res) => {
  const r = storage.loadLatest(parseInt(req.params.n)||7);
  res.json({reports:r, count:r.length});
});

app.get('/api/reports/:date', (req, res) => {
  const r = storage.load(req.params.date);
  if (!r) return res.status(404).json({error:'Not found'});
  res.json(r);
});

app.get('/api/trends', (req, res) => {
  const days = parseInt(req.query.days)||30;
  const reports = storage.loadLatest(days).reverse();
  res.json({
    dates: reports.map(r=>r.date),
    sleep_scores: reports.map(r=>r.scores?.sleep||null),
    readiness_scores: reports.map(r=>r.scores?.readiness||null),
    activity_scores: reports.map(r=>r.scores?.activity||null)
  });
});

app.post('/api/sync', async (req, res) => {
  const { days = 7 } = req.body || {};
  res.json({message:'Sync started', days});
  
  // Run sync in background
  (async () => {
    for (let i = days-1; i >= 0; i--) {
      const date = dayjs().subtract(i,'day').format('YYYY-MM-DD');
      try {
        const report = await buildReport(date);
        storage.save(report);
        console.log('Saved: ' + date + ' ' + report.overall_emoji + ' ' + report.headline);
      } catch(e) { console.error('Failed ' + date + ':', e.message); }
      await new Promise(r=>setTimeout(r,500));
    }
    console.log('Sync complete');
  })();
});

// Cron: every day 8am UTC
cron.schedule('0 8 * * *', async () => {
  const date = dayjs().subtract(1,'day').format('YYYY-MM-DD');
  try {
    const report = await buildReport(date);
    storage.save(report);
    console.log('Daily sync: ' + date + ' ' + report.overall_emoji);
  } catch(e) { console.error('Cron error:', e.message); }
}, {timezone:'UTC'});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Oura Health Sync running on port ' + PORT));
