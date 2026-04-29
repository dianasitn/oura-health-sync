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
  const r = await axios.get(BASE + path, { headers: { Authorization: 'Bearer ' + OURA_TOKEN }, params });
  return r.data.data || r.data;
}

function scoreColor(s) {
  if (!s) return 'нет данных';
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
  const end = dayjs(date).add(1,'day').format('YYYY-MM-DD');
  const [sleepArr, readArr, actArr, stressArr, spo2Arr] = await Promise.allSettled([
    fetchOura('/daily_sleep', {start_date:date, end_date:end}),
    fetchOura('/daily_readiness', {start_date:date, end_date:end}),
    fetchOura('/daily_activity', {start_date:date, end_date:end}),
    fetchOura('/daily_stress', {start_date:date, end_date:end}),
    fetchOura('/daily_spo2', {start_date:date, end_date:end}),
  ]);
  const sleep = sleepArr.status==='fulfilled' ? (sleepArr.value||[]).find(x=>x.day===date)||{} : {};
  const read  = readArr.status==='fulfilled'  ? (readArr.value||[]).find(x=>x.day===date)||{}  : {};
  const act   = actArr.status==='fulfilled'   ? (actArr.value||[]).find(x=>x.day===date)||{}   : {};
  const stress= stressArr.status==='fulfilled'? (stressArr.value||[]).find(x=>x.day===date)||{}: {};
  const spo2  = spo2Arr.status==='fulfilled'  ? (spo2Arr.value||[]).find(x=>x.day===date)||{}  : {};
  const ss = sleep.score, rs = read.score, as = act.score;
  const avg = [ss,rs,as].filter(Boolean).reduce((a,b)=>a+b,0)/([ss,rs,as].filter(Boolean).length||1);
  const status = scoreColor(Math.round(avg));
  const emoji  = scoreEmoji(Math.round(avg));
  const insights = [];
  if (ss) insights.push('Сон: ' + ss + ' баллов — ' + scoreColor(ss));
  if (rs) insights.push('Готовность: ' + rs + ' баллов — ' + scoreColor(rs));
  if (as) insights.push('Активность: ' + as + ' баллов — ' + scoreColor(as));
  if (act.steps) insights.push('Шагов: ' + act.steps.toLocaleString('ru'));
  if (sleep.contributors?.hrv_balance) insights.push('HRV баланс: ' + sleep.contributors.hrv_balance);
  if (spo2.spo2_percentage?.average) insights.push('SpO₂: ' + spo2.spo2_percentage.average.toFixed(1) + '%');
  if (stress.day_summary) insights.push('Стресс: ' + stress.day_summary);
  const recs = [];
  if (ss && ss < 70) recs.push('Лечь спать раньше на 30–60 минут');
  if (rs && rs < 70) recs.push('Снизить интенсивность нагрузок сегодня');
  if (as && as < 70) recs.push('Добавить 20-минутную прогулку');
  if (recs.length === 0) recs.push('Поддерживай текущий режим', 'Гидратация: 2л воды', '10 минут растяжки вечером');
  const headline = (ss && rs) ? 'Сон ' + ss + ' · Готовность ' + rs + ' · Активность ' + (as||'—') : 'Данные за ' + date;
  return {
    date, overall_status: status, overall_emoji: emoji, headline,
    scores: { sleep: ss||null, readiness: rs||null, activity: as||null },
    key_insights: insights.slice(0,6),
    sleep_summary: ss ? 'Оценка сна: ' + ss + ' (' + scoreColor(ss) + ').' + (read.temperature_deviation ? ' Отклонение температуры: ' + read.temperature_deviation.toFixed(2) + '°C.' : '') : 'Нет данных.',
    recovery_summary: rs ? 'Индекс готовности: ' + rs + '. ' + (read.contributors?.hrv_balance ? 'HRV баланс: ' + read.contributors.hrv_balance + '.' : '') : 'Нет данных.',
    activity_summary: as ? 'Активность: ' + as + ' баллов. Шагов: ' + (act.steps||'—') + '. Калорий: ' + (act.active_calories||'—') : 'Нет данных.',
    stress_recovery_balance: stress.day_summary || (stress.stress_high ? 'Стресс: ' + Math.round(stress.stress_high/60) + ' мин, восстановление: ' + Math.round((stress.recovery_high||0)/60) + ' мин' : 'Нет данных.'),
    recommendations: recs,
    compared_to_yesterday: '—',
    highlight_metric: ss ? {label:'Сон', value:ss+' баллов', note:scoreColor(ss)} : {label:'—',value:'—',note:'—'},
    concern_metric: (rs && rs < 70) ? {label:'Готовность', value:rs+' баллов', note:'Рекомендован отдых'} : {label:'—',value:'—',note:'Всё в норме'},
    generated_at: new Date().toISOString(), source: 'rule-based'
  };
}

// ── AI Insights engine ─────────────────────────────────────────────────────
function generateInsights(reports) {
  const valid = reports.filter(r => r.scores?.sleep && r.scores?.readiness);
  if (valid.length < 3) return [];
  
  const insights = [];
  const sleeps = valid.map(r => r.scores.sleep).filter(Boolean);
  const reads  = valid.map(r => r.scores.readiness).filter(Boolean);
  const acts   = valid.map(r => r.scores.activity).filter(Boolean);
  const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;
  const avgS = avg(sleeps), avgR = avg(reads), avgA = avg(acts);

  // Trend: last 7 vs prev 7
  const recent7 = valid.slice(0,7), prev7 = valid.slice(7,14);
  const recentAvgS = avg(recent7.map(r=>r.scores.sleep).filter(Boolean));
  const prevAvgS   = avg(prev7.map(r=>r.scores.sleep).filter(Boolean));
  const recentAvgR = avg(recent7.map(r=>r.scores.readiness).filter(Boolean));
  const prevAvgR   = avg(prev7.map(r=>r.scores.readiness).filter(Boolean));

  if (recentAvgS && prevAvgS) {
    const diff = recentAvgS - prevAvgS;
    if (diff >= 5) insights.push({ type: 'positive', icon: '📈', title: 'Сон улучшается', text: 'За последние 7 дней средний балл сна вырос на ' + Math.abs(diff) + ' пунктов по сравнению с предыдущей неделей (' + recentAvgS + ' vs ' + prevAvgS + ').' });
    else if (diff <= -5) insights.push({ type: 'warning', icon: '📉', title: 'Сон ухудшается', text: 'Средний балл сна снизился на ' + Math.abs(diff) + ' пунктов за последние 7 дней. Обратите внимание на режим отхода ко сну.' });
  }
  if (recentAvgR && prevAvgR) {
    const diff = recentAvgR - prevAvgR;
    if (diff >= 5) insights.push({ type: 'positive', icon: '⚡', title: 'Восстановление растёт', text: 'Готовность улучшилась на ' + Math.abs(diff) + ' пунктов за неделю. Организм хорошо адаптируется к нагрузкам.' });
    else if (diff <= -5) insights.push({ type: 'warning', icon: '⚠️', title: 'Снижение восстановления', text: 'Готовность снизилась на ' + Math.abs(diff) + ' пунктов. Возможно, накопилась усталость — стоит дать организму больше отдыха.' });
  }

  // Best/worst days
  const sorted = [...valid].sort((a,b) => (b.scores.sleep||0)+(b.scores.readiness||0) - ((a.scores.sleep||0)+(a.scores.readiness||0)));
  if (sorted.length >= 2) {
    const best = sorted[0], worst = sorted[sorted.length-1];
    insights.push({ type: 'info', icon: '🏆', title: 'Лучший день', text: best.date + ': сон ' + best.scores.sleep + ', готовность ' + best.scores.readiness + '. Что помогло в этот день?' });
  }

  // Sleep-readiness correlation
  const highSleepLowRead = valid.filter(r => r.scores.sleep >= 80 && r.scores.readiness < 70).length;
  if (highSleepLowRead >= 3) insights.push({ type: 'insight', icon: '🔬', title: 'Паттерн: сон не восстанавливает', text: highSleepLowRead + ' раз за 30 дней: высокий сон (≥80) при низкой готовности (<70). Возможен скрытый стресс или воспаление.' });

  // Consistency
  const lowDays = valid.filter(r => (r.scores.sleep||0) < 60).length;
  if (lowDays >= 5) insights.push({ type: 'warning', icon: '😴', title: 'Частые плохие ночи', text: lowDays + ' дней из ' + valid.length + ' — сон ниже 60 баллов. Рекомендуется проверить режим и условия сна.' });
  
  const excellentDays = valid.filter(r => (r.scores.sleep||0) >= 85 && (r.scores.readiness||0) >= 85).length;
  if (excellentDays >= 3) insights.push({ type: 'positive', icon: '🌟', title: 'Дни пиковой формы', text: excellentDays + ' дней за месяц с отличными показателями по сну и готовности (≥85). Это ' + Math.round(excellentDays/valid.length*100) + '% дней.' });

  // Activity pattern
  if (avgA && avgA < 65) insights.push({ type: 'recommendation', icon: '🏃', title: 'Активность ниже нормы', text: 'Средний балл активности ' + avgA + '. Регулярные прогулки 30+ минут помогут улучшить этот показатель.' });
  
  // Overall summary
  insights.unshift({ type: 'summary', icon: '📊', title: 'Сводка за 30 дней', text: 'Средний сон: ' + avgS + '/100 · Готовность: ' + avgR + '/100 · Активность: ' + (avgA||'—') + '/100. Проанализировано ' + valid.length + ' дней.' });

  return insights.slice(0, 8);
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

// ── NEW: AI Insights endpoint ──────────────────────────────────────────────
app.get('/api/insights', (req, res) => {
  try {
    const reports = storage.loadLatest(30);
    const insights = generateInsights(reports);
    res.json({ insights, count: insights.length, generated_at: new Date().toISOString() });
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/sync', async (req, res) => {
  const { days = 7 } = req.body || {};
  res.json({message:'Sync started', days});
  (async () => {
    for (let i = days-1; i >= 0; i--) {
      const date = dayjs().subtract(i,'day').format('YYYY-MM-DD');
      try {
        const report = await buildReport(date);
        storage.save(report);
        console.log('Saved: ' + date + ' ' + report.overall_emoji);
      } catch(e) { console.error('Failed ' + date + ':', e.message); }
      await new Promise(r=>setTimeout(r,500));
    }
    console.log('Sync complete');
  })();
});

cron.schedule('0 8 * * *', async () => {
  const date = dayjs().subtract(1,'day').format('YYYY-MM-DD');
  try { const report = await buildReport(date); storage.save(report); console.log('Daily: ' + date); }
  catch(e) { console.error('Cron error:', e.message); }
}, {timezone:'UTC'});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Oura Health Sync running on port ' + PORT));
