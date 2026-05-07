require('dotenv').config();
const {InfluxDB,Point}=require('@influxdata/influxdb-client');
const client=new InfluxDB({url:process.env.INFLUX_URL,token:process.env.INFLUX_TOKEN});
const org=process.env.INFLUX_ORG,bucket=process.env.INFLUX_BUCKET;

async function save(r){const w=client.getWriteApi(org,bucket,'ns');w.writePoint(new Point('oura_report').timestamp(new Date(r.date+'T12:00:00Z').getTime()*1e6).tag('date',r.date).stringField('json',JSON.stringify(r)));await w.close();console.log('[DB] Saved '+r.date);}

async function load(date){const rows=[];await new Promise((res,rej)=>client.getQueryApi(org).queryRows('from(bucket:"'+bucket+'") |> range(start:-400d) |> filter(fn:(r)=>r._measurement=="oura_report" and r.date=="'+date+'") |> last()',{next(row,m){rows.push(m.toObject(row))},error:rej,complete:res}));return rows.length?JSON.parse(rows[0]._value):null;}

async function listAll(){const rows=[];await new Promise((res,rej)=>client.getQueryApi(org).queryRows('from(bucket:"'+bucket+'") |> range(start:-400d) |> filter(fn:(r)=>r._measurement=="oura_report") |> group(columns:["date"]) |> last() |> sort(columns:["date"],desc:true)',{next(row,m){rows.push(m.toObject(row))},error:rej,complete:res}));return rows.map(r=>{const d=JSON.parse(r._value);return{date:d.date,overall_status:d.overall_status,overall_emoji:d.overall_emoji,headline:d.headline,scores:d.scores,generated_at:d.generated_at};});}

async function loadLatest(n=7){const all=await listAll();return all.slice(0,n).map(r=>JSON.parse(JSON.stringify(r)));}

module.exports={save,load,listAll,loadLatest};
