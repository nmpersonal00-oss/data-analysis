/* Pre-specified descriptive statistics for a two-person observational study.
   No imputation, p-values, effect estimates, or causal claims. */
export function localDay(instant,zone='America/Los_Angeles'){
  const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(instant instanceof Date?instant:new Date(instant));
  const get=t=>p.find(x=>x.type===t)?.value;
  return [get('year'),get('month'),get('day')].join('-');
}
export function dayCount(a,b){
  if(!a||!b||b<a)return 0;
  return Math.floor((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000)+1;
}
export function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
export function median(xs){
  if(!xs.length)return null;
  const a=[...xs].sort((x,y)=>x-y),n=a.length;
  return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;
}
export function standardDeviation(xs){
  if(xs.length<2)return null;
  const m=mean(xs);
  return Math.sqrt(xs.reduce((a,b)=>a+(b-m)**2,0)/(xs.length-1));
}
export const measures=[
  {key:'calm',label:'Calm',meaning:'0 = not calm; 10 = very calm'},
  {key:'tension',label:'Tension',meaning:'0 = no tension; 10 = very high tension'},
  {key:'anger',label:'Anger',meaning:'0 = no anger; 10 = very high anger'},
  {key:'happiness',label:'Happiness',meaning:'0 = not happy; 10 = very happy'},
  {key:'closeness',label:'Closeness',meaning:'0 = not close; 10 = very close'},
  {key:'communication',label:'Communication',meaning:'0 = very poor; 10 = excellent'},
  {key:'externalStress',label:'Outside stress',meaning:'0 = none; 10 = extreme'}
];
export function observedRows(vault,participantId){
  const dateLimit=studyEndDay(vault.study);
  return vault.diaries.filter(r=>r.personId===participantId &&
    r.day>=vault.study.start && r.day<=dateLimit)
    .sort((a,b)=>a.day.localeCompare(b.day));
}
export function studyEndDay(study,now=new Date()){
  const today=localDay(now,study.timezone);
  if(!study.stop?.time)return today;
  const ended=localDay(study.stop.time,study.timezone);
  return ended<today?ended:today;
}
export function summarize(vault,personId,now=new Date()){
  const study=vault.study, end=studyEndDay(study,now);
  const rows=vault.diaries.filter(r=>r.personId===personId && r.day>=study.start && r.day<=end);
  const expected=dayCount(study.start,end),n=rows.length;
  const scores={};
  for(const m of measures){
    const values=rows.map(r=>r[m.key]).filter(v=>Number.isFinite(v));
    scores[m.key]={mean:mean(values),median:median(values),sd:standardDeviation(values),n:values.length};
  }
  const counted=['disagreements','tensionEpisodes','angerEpisodes'];
  const episodes=Object.fromEntries(counted.map(k=>{
    const values=rows.map(r=>r[k]).filter(Number.isFinite);
    return [k,{total:values.length?values.reduce((a,b)=>a+b,0):null,
      meanPerRecordedDay:mean(values),daysWithAtLeastOne:values.filter(v=>v>0).length}];
  }));
  return {expected,recorded:n,missing:Math.max(0,expected-n),
    completeness:expected?100*n/expected:null,scores,episodes,rows:rows.sort((a,b)=>a.day.localeCompare(b.day))};
}
export function dailyTrajectory(vault,measure,personIds){
  const end=studyEndDay(vault.study),ids=new Set(personIds);
  return vault.diaries.filter(r=>ids.has(r.personId)&&r.day>=vault.study.start&&r.day<=end)
    .filter(r=>Number.isFinite(r[measure]))
    .map(r=>({day:r.day,id:r.personId,value:r[measure]}))
    .sort((a,b)=>a.day.localeCompare(b.day));
}
function csvCell(v){
  if(v==null)return '';
  let text=String(v);
  if(/^\s*[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function csvFromVault(vault,kind='diaries'){
  const keys=kind==='events'?
    ['id','personId','occurredAt','type','severity','durationMinutes','context','createdAt']:
    ['id','personId','day','calm','tension','anger','happiness','closeness',
      'communication','externalStress','disagreements','tensionEpisodes','angerEpisodes',
      'sleepHours','togetherMinutes','notes','createdAt','updatedAt'];
  const rows=kind==='events'?vault.events:vault.diaries;
  const result=[['protocol_version','study_id',...keys].join(',')];
  for(const r of rows){
    result.push([vault.study.version,vault.study.id,...keys.map(k=>r[k])].map(csvCell).join(','));
  }
  return result.join('\r\n')+'\r\n';
}
