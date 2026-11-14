import {getStore} from '@netlify/blobs';
import {timingSafeEqual} from 'node:crypto';
const h={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:h});
function secureCompare(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
const defaultRound={id:'legacy',name:'الجولة الأولى',createdAt:null};
const prefix=r=>r.id==='legacy'?'attempts/':`rounds/${r.id}/attempts/`;
async function getEntries(store,r){const entries=[];let cursor;do{const page=await store.list({prefix:prefix(r),...(cursor?{cursor}:{})});for(const item of page.blobs){try{const entry=await store.get(item.key,{type:'json'});if(entry)entries.push(entry);}catch{}}cursor=page.cursor;}while(cursor && entries.length<10000);return entries;}
export default async request=>{
 if(request.method!=='POST')return reply({error:'طريقة طلب غير مدعومة'},405);
 if(!process.env.TEACHER_ADMIN_PASSWORD || process.env.TEACHER_ADMIN_PASSWORD.length<12)return reply({error:'يجب تعيين TEACHER_ADMIN_PASSWORD في إعدادات Netlify بطول 12 حرفًا على الأقل'},503);
 let body;try{if(Number(request.headers.get('content-length')||0)>4096)return reply({error:'طلب كبير'},413);body=await request.json();}catch{return reply({error:'البيانات غير صالحة'},400);}
 if(typeof body?.password!=='string'||!secureCompare(body.password,process.env.TEACHER_ADMIN_PASSWORD))return reply({error:'كلمة المرور غير صحيحة'},401);
 try{
  const store=getStore('volunteer-quiz-entries-v1');
  let round=await store.get('config/active-round',{type:'json'})||defaultRound;
  if(body.action==='newRound'){
    const name=typeof body.roundName==='string'?body.roundName.trim():'';
    if(!name||name.length>75||/[<>\x00-\x1f]/.test(name))return reply({error:'أدخل اسمًا صالحًا للجولة (1–75 حرفًا)'},400);
    const history=await store.get('config/round-history',{type:'json'})||[];
    const newRound={id:crypto.randomUUID(),name,createdAt:new Date().toISOString()};
    await store.setJSON('config/round-history',[...history.filter(r=>r.id!==round.id),round].slice(-100));
    await store.setJSON('config/active-round',newRound);
    return reply({success:true,round:newRound});
  }
  if(body.action==='listRounds'){
    const history=await store.get('config/round-history',{type:'json'})||[];
    return reply({rounds:[round,...history.filter(r=>r.id!==round.id).reverse()]});
  }
  if(body.action!=='overview')return reply({error:'عملية غير معروفة'},400);
  const selected=typeof body.roundId==='string'?body.roundId:round.id;
  const history=await store.get('config/round-history',{type:'json'})||[];
  const selectedRound=[round,...history].find(r=>r.id===selected);
  if(!selectedRound)return reply({error:'الجولة غير موجودة'},404);
  const entries=await getEntries(store,selectedRound);
  const results=entries.map(e=>({name:e.name,grade:e.grade,score:e.score,total:e.total,date:e.date,publishName:e.publishName})).sort((a,b)=>b.score-a.score||b.date.localeCompare(a.date));
  const scores=Array.from({length:11},(_,i)=>results.filter(e=>e.score===i).length);
  return reply({round:selectedRound,activeRoundId:round.id,totalAttempts:results.length,average:results.length?Math.round(results.reduce((n,e)=>n+e.score,0)/results.length*10):0,qualified:results.filter(e=>e.score>=7).length,perfect:results.filter(e=>e.score===10).length,scores,results});
 }catch(e){console.error('admin:',e);return reply({error:'تعذر قراءة أو تحديث النتائج'},503);}
};
