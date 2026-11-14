import { getStore } from '@netlify/blobs';
import { questions } from './lib/questions.mjs';

const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const respond = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
const activeRound = async store => (await store.get('config/active-round',{type:'json'})) || {id:'legacy',name:'الجولة الأولى',createdAt:null};
const roundPrefix = round => round.id === 'legacy' ? 'attempts/' : `rounds/${round.id}/attempts/`;
const validName = name => typeof name === 'string' && name.trim().length >= 3 && name.trim().length <= 70 && !/[<>\x00-\x1f]/.test(name);

export default async (request) => {
  if(request.method !== 'POST' && request.method !== 'GET') return respond({error:'طريقة طلب غير مدعومة'},405);
  try {
    const store = getStore('volunteer-quiz-entries-v1');
    const round = await activeRound(store);
    if(request.method === 'POST') {
      const raw = await request.text();
      if(raw.length > 10000) return respond({error:'الطلب كبير جدا'},413);
      let payload;
      try { payload = JSON.parse(raw); } catch {return respond({error:'البيانات غير صالحة'},400);}
      const {name,grade,answers,publishName,sessionId} = payload ?? {};
      if(!validName(name) || typeof grade !== 'string' || grade.length > 50 ||
         !Array.isArray(answers) || answers.length !== questions.length ||
         answers.some(a => !Number.isInteger(a) || a < -1 || a > 1) ||
         typeof publishName !== 'boolean' ||
         typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(sessionId)) {
        return respond({error:'تحقق من الاسم والصف والإجابات'},400);
      }
      const score = answers.reduce((sum,answer,i) => sum+(answer === questions[i].correct ? 1 : 0),0);
      const key = `${roundPrefix(round)}${sessionId}`;
      const entry = { name:name.trim(),grade:grade.trim() || 'غير محدد',score,total:questions.length,publishName,date:new Date().toISOString() };
      const saved = await store.setJSON(key,entry,{onlyIfNew:true});
      if(!saved.modified) return respond({error:'تم تسجيل هذه المحاولة سابقا'},409);
      return respond({success:true,score,total:questions.length,round:round.name});
    }
    const {blobs} = await store.list({prefix:roundPrefix(round)});
    // Public board: only participants who consented to showing their name.
    const entries = await Promise.all(blobs.slice(-1500).map(async b => {
      try {return await store.get(b.key,{type:'json'});}catch{return null;}
    }));
    const qualified = entries.filter(e => e?.publishName && e.score >= 7 && typeof e.name === 'string');
    // Each name is displayed at most once, with the best attempt.
    const best = new Map();
    for(const e of qualified) {
      const k = `${e.name.trim().toLocaleLowerCase('ar')}|${e.grade.trim().toLocaleLowerCase('ar')}`;
      const old = best.get(k);
      if(!old || e.score > old.score || (e.score === old.score && e.date < old.date)) best.set(k,e);
    }
    const leaderboard = [...best.values()].sort((a,b)=>b.score-a.score || a.date.localeCompare(b.date)).slice(0,50).map(e=>({name:e.name,grade:e.grade,score:e.score,total:e.total,date:e.date}));
    return respond({roundName:round.name,leaderboard,qualifiedCount:best.size,perfectCount:[...best.values()].filter(e=>e.score===questions.length).length});
  } catch(error) {
    console.error('quiz function:',error);
    return respond({error:'تعذر الاتصال بحفظ النتائج. حاول مجددا لاحقا.'},503);
  }
};
