import {
  createVault, unlockVault, saveVault, lockVault, hasVault,
  encryptedBackup, restoreBackup, deleteVault
} from './db.js';
import {
  localDay, dayCount, summarize, measures, mean,
  dailyTrajectory, studyEndDay, csvFromVault
} from './analytics.js';

const $=id=>document.getElementById(id);
const svgNS='http://www.w3.org/2000/svg';
let vault=null, personId=null, working=false;
const requiredMeasures=['calm','tension','anger','happiness','closeness'];
const metricKeys=['disagreements','tensionEpisodes','angerEpisodes','sleepHours','togetherMinutes'];
const boundReasons={
  physical_contact:'Physical contact',
  uncovered_body:'Body coverage',
  sexual_flirting:'Sexual flirting',
  undressing:'Undressing',
  voluntary:'Voluntary early stop / withdrawal',
  other:'Other reason'
};
const kinds={tension:'Tension',anger:'Anger',disagreement:'Disagreement',
  repair:'Calming / resolution',positive:'Positive connection'};
function fmt(x,d=1){return x==null||!Number.isFinite(x)?'—':Number(x).toFixed(d);}
function textElement(tag,txt,cls){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  el.textContent=txt;
  return el;
}
function flash(message,isError=false){
  const el=$('flash');el.textContent=message;
  el.className='flash'+(isError?' error':'');
  el.hidden=false;
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function clearFlash(){$('flash').hidden=true;}
function throwIfStopped(){
  if(!vault||vault.study.status!=='active')throw new Error('The observation has ended. New records are not permitted.');
}
function today(){return localDay(new Date(),vault?.study.timezone||'America/Los_Angeles');}
function pName(id){return vault?.participants.find(p=>p.id===id)?.name||'Participant';}
function participant(){return vault?.participants.find(p=>p.id===personId);}
function localInputTime(){
  const now=new Date(),p=new Date(now.getTime()-now.getTimezoneOffset()*60000);
  return p.toISOString().slice(0,16);
}
function requiredInt(id,max=30){
  const x=Number($(id).value);
  if(!$(id).value||!Number.isInteger(x)||x<0||x>max)
    throw new Error('Enter a whole number from 0 to '+max+' for '+id+'.');
  return x;
}
function optionalNumber(id,max,step){
  const s=$(id).value.trim();
  if(s==='')return null;
  const n=Number(s);
  if(!Number.isFinite(n)||n<0||n>max||
     (step===1&&!Number.isInteger(n))||(step===0.5&&Math.round(n*2)!==n*2))
    throw new Error('Invalid value for '+id+'.');
  return n;
}
function download(name,text,mime='text/plain;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type:mime}));
  const a=document.createElement('a');a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function perform(ev,task){
  ev?.preventDefault?.();
  if(working)return;
  working=true;
  try{await task();}
  catch(error){console.error('[Sakinah research]',error);flash(error?.message||'Something went wrong.',true);}
  finally{working=false;}
}
async function persist(mutator,message){
  throwIfStopped();
  const candidate=structuredClone(vault);
  mutator(candidate);
  await saveVault(candidate);
  vault=candidate;
  renderAll();
  if(message)flash(message);
}
function setupMeasures(){
  const holder=$('scaleFields');
  holder.replaceChildren();
  for(const m of measures){
    const block=document.createElement('div');block.className='scale-field';
    const lab=document.createElement('label');lab.htmlFor='m_'+m.key;
    lab.textContent=m.label+(requiredMeasures.includes(m.key)?' *':' · optional');
    const sel=document.createElement('select');sel.id='m_'+m.key;
    sel.required=requiredMeasures.includes(m.key);
    sel.append(new Option('Choose 0–10',''));
    for(let n=0;n<=10;n++)sel.append(new Option(String(n),String(n)));
    const hint=textElement('div',m.meaning,'fine');
    block.append(lab,sel,hint);holder.append(block);
  }
}
function setLockedInputs(){
  const stopped=vault?.study.status==='stopped';
  for(const id of ['diaryForm','eventForm','stopForm']){
    for(const field of $(id).querySelectorAll('input,textarea,select,button'))field.disabled=stopped;
  }
  $('deleteDiary').disabled=stopped;
  if(stopped){
    $('diaryHint').textContent='Observation ended. Historical data can still be viewed and exported.';
    $('stopPanel').classList.add('stopped-panel');
  }else{
    $('stopPanel').classList.remove('stopped-panel');
  }
}
function activateUI(){
  $('welcome').hidden=!!vault;
  $('workspace').hidden=!vault;
  $('lockButton').hidden=!vault;
  if(!vault)return;
  const picker=$('personPicker');
  if(!vault.participants.some(p=>p.id===personId))personId=vault.participants[0].id;
  picker.replaceChildren();
  for(const p of vault.participants)picker.append(new Option(p.name+' · '+p.code,p.id));
  picker.value=personId;
  $('diaryDate').min=vault.study.start;
  $('diaryDate').max=studyEndDay(vault.study);
  if(!$('diaryDate').value||$('diaryDate').value<$('diaryDate').min||
    $('diaryDate').value>$('diaryDate').max)
    $('diaryDate').value=$('diaryDate').max;
  if(!$('eventWhen').value)$('eventWhen').value=localInputTime();
  const badge=$('statusBadge');
  badge.className='status-pill'+(vault.study.status==='stopped'?' stopped':'');
  badge.textContent=vault.study.status==='stopped'?'STUDY ENDED':'OBSERVING';
  const ending=studyEndDay(vault.study);
  $('daysInfo').textContent=vault.study.status==='stopped'?
    'Ended '+ending+' · '+dayCount(vault.study.start,ending)+' calendar day(s)':
    'Day '+dayCount(vault.study.start,ending)+' of observation · '+vault.study.timezone;
  const stop=vault.study.stop;
  $('stopNotice').textContent=stop?
    'Stopped '+new Date(stop.time).toLocaleString()+' · '+(boundReasons[stop.reason]||'Stopped')+
      ' · reported by '+pName(stop.reportedBy):'Either participant can end the study at any time.';
  setLockedInputs();
}
function selectedEntry(){
  return vault.diaries.find(d=>d.personId===personId&&d.day===$('diaryDate').value);
}
function populateDiary(){
  if(!vault)return;
  const entry=selectedEntry();
  for(const m of measures){
    $('m_'+m.key).value=entry?.[m.key]==null?'':String(entry[m.key]);
  }
  for(const key of metricKeys){
    $(key).value=entry?.[key]==null?(key==='disagreements'||key==='tensionEpisodes'||key==='angerEpisodes'?'0':''):String(entry[key]);
  }
  $('diaryNotes').value=entry?.notes||'';
  $('deleteDiary').hidden=!entry||vault.study.status==='stopped';
  $('diaryHint').textContent=vault.study.status==='stopped'?'The observation has stopped. Entries are read-only.':
    entry?'Editing a previously recorded day. An audit entry will preserve the correction.':
      'This date has no entry yet. No data will be assumed for missing days.';
}
function renderDiaryList(){
  const body=$('diaryTable');body.replaceChildren();
  const mine=vault.diaries.filter(d=>d.personId===personId)
    .sort((a,b)=>b.day.localeCompare(a.day));
  if(!mine.length){
    const tr=document.createElement('tr'),cell=document.createElement('td');
    cell.colSpan=6;cell.textContent='No entries for this participant yet.';
    tr.append(cell);body.append(tr);return;
  }
  for(const d of mine){
    const tr=document.createElement('tr');
    for(const v of [d.day,d.calm,d.tension,d.anger,d.disagreements]){
      tr.append(textElement('td',String(v??'—')));
    }
    const cell=document.createElement('td'),btn=document.createElement('button');
    btn.type='button';btn.className='button small ghost';btn.textContent='View';
    btn.addEventListener('click',()=>{
      $('diaryDate').value=d.day;populateDiary();openTab('diary');
      $('diaryForm').scrollIntoView({behavior:'smooth',block:'start'});
    });
    cell.append(btn);tr.append(cell);body.append(tr);
  }
}
function statCard(label,value,tag){
  const card=document.createElement('div');card.className='stat';
  card.append(textElement('span',tag,'tag'),textElement('strong',value),textElement('label',label));
  return card;
}
function renderOverview(){
  const s=summarize(vault,personId);
  $('overviewTitle').textContent=pName(personId)+' · observation summary';
  const grid=$('summaryCards');grid.replaceChildren(
    statCard('Recorded days',s.recorded+'/'+s.expected,'DAILY COVERAGE'),
    statCard('Average calm',fmt(s.scores.calm.mean),'0 TO 10 SCALE'),
    statCard('Average tension',fmt(s.scores.tension.mean),'0 TO 10 SCALE'),
    statCard('Average anger',fmt(s.scores.anger.mean),'0 TO 10 SCALE'),
    statCard('Total disagreements',s.episodes.disagreements.total==null?'—':String(s.episodes.disagreements.total),'RECORDED DAYS'),
    statCard('Tension episodes',s.episodes.tensionEpisodes.total==null?'—':String(s.episodes.tensionEpisodes.total),'RECORDED DAYS'),
    statCard('Anger episodes',s.episodes.angerEpisodes.total==null?'—':String(s.episodes.angerEpisodes.total),'RECORDED DAYS'),
    statCard('Average happiness',fmt(s.scores.happiness.mean),'0 TO 10 SCALE')
  );
  const box=$('coverageBlock');
  box.replaceChildren();
  const hdr=document.createElement('div');hdr.className='coverage-head';
  hdr.append(textElement('span',s.recorded+' recorded / '+s.expected+' expected days'),
    textElement('span',fmt(s.completeness,0)+'%'));
  const track=document.createElement('div');track.className='progress-track';
  const fill=document.createElement('div');fill.className='progress-fill';
  fill.style.width=Math.max(0,Math.min(100,s.completeness||0))+'%';
  track.append(fill);
  box.append(hdr,track,textElement('p',s.missing+' missing day(s). No value is assumed when a day has not been recorded.','support'));
}
function renderEvents(){
  const box=$('eventList');box.replaceChildren();
  const sorted=[...vault.events].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  if(!sorted.length){box.append(textElement('p','No events recorded. This optional journal is separate from daily counts.','support'));return;}
  for(const ev of sorted){
    const card=document.createElement('div');card.className='event-card';
    const left=document.createElement('div'),title=textElement('div',kinds[ev.type]||ev.type,'type');
    const meta=textElement('small',pName(ev.personId)+' · '+new Date(ev.occurredAt).toLocaleString()+
      ' · intensity '+ev.severity+'/10 · '+ev.durationMinutes+' min');
    left.append(title,meta);
    if(ev.context)left.append(textElement('p',ev.context));
    card.append(left);
    if(vault.study.status==='active'){
      const del=document.createElement('button');del.type='button';del.className='button small ghost';del.textContent='Delete';
      del.addEventListener('click',e=>perform(e,async()=>{
        if(!confirm('Delete this event? The deletion will be noted in the audit history.'))return;
        await persist(d=>{
          const original=d.events.find(x=>x.id===ev.id);
          d.events=d.events.filter(x=>x.id!==ev.id);
          d.audit.push({id:crypto.randomUUID(),at:new Date().toISOString(),action:'delete_event',
            personId,recordId:ev.id,old:original});
        },'Event removed and correction recorded.');
      }));
      card.append(del);
    }
    box.append(card);
  }
}
function createSvg(tag,attrs={},text=''){
  const el=document.createElementNS(svgNS,tag);
  for(const [name,value] of Object.entries(attrs))el.setAttribute(name,String(value));
  if(text)el.textContent=text;
  return el;
}
function renderChart(){
  const chart=$('chart');chart.replaceChildren();
  const measure=$('chartMeasure').value;
  const series=dailyTrajectory(vault,measure,vault.participants.map(p=>p.id));
  const maxX=830,minX=48,minY=20,maxY=265;
  for(let value=0;value<=10;value+=2){
    const y=maxY-value/10*(maxY-minY);
    chart.append(createSvg('line',{x1:minX,y1:y,x2:maxX,y2:y,stroke:'#e5eae3','stroke-width':1}),
      createSvg('text',{x:minX-12,y:y+4,'text-anchor':'end',fill:'#809187','font-size':12},String(value)));
  }
  const legend=$('chartLegend');legend.replaceChildren();
  vault.participants.forEach((p,i)=>{
    const item=textElement('span',p.name);
    item.style.setProperty('--legend-color',i?'#bf9966':'#31806a');
    legend.append(item);
  });
  if(!series.length){
    chart.append(createSvg('text',{x:430,y:150,'text-anchor':'middle',fill:'#74877d','font-size':16},
      'No ratings recorded yet. Add a daily diary entry.'));
    return;
  }
  const start=Date.parse(series[0].day+'T00:00:00Z'),
    end=Date.parse(series.at(-1).day+'T00:00:00Z');
  const x=d=>minX+(start===end ? 0.5 : (Date.parse(d+'T00:00:00Z')-start)/(end-start))*(maxX-minX);
  const y=v=>maxY-v/10*(maxY-minY);
  for(const [i,p] of vault.participants.entries()){
    const color=i?'#bf9966':'#31806a',pts=series.filter(r=>r.id===p.id);
    for(let j=1;j<pts.length;j++){
      const earlier=Date.parse(pts[j-1].day+'T00:00:00Z');
      const later=Date.parse(pts[j].day+'T00:00:00Z');
      if(later-earlier!==86400000)continue;
      chart.append(createSvg('line',{x1:x(pts[j-1].day),y1:y(pts[j-1].value),
        x2:x(pts[j].day),y2:y(pts[j].value),stroke:color,'stroke-width':2.5}));
    }
    pts.forEach(p=>{
      const c=createSvg('circle',{cx:x(p.day),cy:y(p.value),r:4,fill:color});
      c.append(createSvg('title',{},p.day+' · '+p.value));
      chart.append(c);
    });
  }
  chart.append(createSvg('text',{x:minX,y:290,'font-size':12,fill:'#819489'},series[0].day),
    createSvg('text',{x:maxX,y:290,'text-anchor':'end','font-size':12,fill:'#819489'},series.at(-1).day));
}
function renderAnalysis(){
  $('headerPersonA').textContent=vault.participants[0].name;
  $('headerPersonB').textContent=vault.participants[1].name;
  const both=vault.participants.map(p=>summarize(vault,p.id));
  const specs=[
    ['Days recorded',s=>s.recorded+' / '+s.expected],
    ['Missing days',s=>s.missing],
    ['Observation coverage',s=>fmt(s.completeness,0)+'%'],
    ...measures.map(m=>['Mean '+m.label.toLowerCase()+' (0–10)',s=>fmt(s.scores[m.key].mean)]),
    ['Median calm',s=>fmt(s.scores.calm.median)],
    ['Calm standard deviation',s=>fmt(s.scores.calm.sd,2)],
    ['Total disagreements',s=>s.episodes.disagreements.total??'—'],
    ['Disagreements / recorded day',s=>fmt(s.episodes.disagreements.meanPerRecordedDay,2)],
    ['Total tension episodes',s=>s.episodes.tensionEpisodes.total??'—'],
    ['Total anger episodes',s=>s.episodes.angerEpisodes.total??'—']
  ];
  const body=$('analysisTable');body.replaceChildren();
  for(const [label,fn] of specs){
    const tr=document.createElement('tr');
    tr.append(textElement('td',label),textElement('td',String(fn(both[0]))),
      textElement('td',String(fn(both[1]))));
    body.append(tr);
  }
  const quality=$('qualityNotes');quality.replaceChildren();
  const notes=[
    ['Missingness','Unrecorded days are excluded from means. Low diary completion can distort apparent trends.'],
    ['No measured comparison period','Earlier experiences were recalled, not collected with the same instrument. There is no observed pre-boundary baseline.'],
    ['Confounding & early stop','Outside stress, sleep, changes in time together, expectation effects, and boundary-triggered stopping can affect these trends.']
  ];
  for(const [name,desc] of notes){
    const div=document.createElement('div');
    div.append(textElement('strong',name),textElement('p',desc));
    quality.append(div);
  }
  renderChart();
}
function renderAll(){
  activateUI();
  if(!vault)return;
  renderOverview();
  renderDiaryList();
  populateDiary();
  renderEvents();
  renderAnalysis();
}
function openTab(name){
  document.querySelectorAll('.tabview').forEach(el=>el.hidden=el.id!==name);
  document.querySelectorAll('.tab').forEach(el=>{
    const active=el.dataset.tab===name;
    el.classList.toggle('active',active);
    if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
}
function setupHandlers(){
  setupMeasures();
  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>openTab(btn.dataset.tab)));
  document.querySelectorAll('.jump').forEach(btn=>btn.addEventListener('click',()=>openTab(btn.dataset.go)));
  $('lockButton').addEventListener('click',()=>{
    lockVault();vault=null;personId=null;activateUI();
    $('unlockPass').value='';flash('Vault locked. Your encrypted records remain on this browser.');
  });
  $('createForm').addEventListener('submit',e=>perform(e,async()=>{
    const pass=$('createPass').value;
    const next=await createVault(pass,$('createA').value,$('createB').value,$('createTimezone').value);
    vault=next;personId=vault.participants[0].id;
    $('createForm').querySelector('button[type=submit]').disabled=true;
    $('createForm').querySelector('button[type=submit]').textContent='A vault already exists on this browser';
    $('createPass').value='';clearFlash();openTab('overview');renderAll();
    flash('Private research vault created. Download an encrypted backup from Data & privacy.');
  }));
  $('unlockForm').addEventListener('submit',e=>perform(e,async()=>{
    vault=await unlockVault($('unlockPass').value);
    personId=vault.participants[0].id;
    $('unlockPass').value='';clearFlash();openTab('overview');renderAll();
    flash('Your encrypted study is unlocked.');
  }));
  $('personPicker').addEventListener('change',()=>{
    personId=$('personPicker').value;renderAll();
  });
  $('diaryDate').addEventListener('change',populateDiary);
  $('chartMeasure').addEventListener('change',renderChart);
  $('diaryForm').addEventListener('submit',e=>perform(e,async()=>{
    throwIfStopped();
    const day=$('diaryDate').value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<vault.study.start||day>today())
      throw new Error('Choose a day between the study start and today.');
    const measurements={};
    for(const m of measures){
      const raw=$('m_'+m.key).value;
      if(raw===''){
        if(requiredMeasures.includes(m.key))throw new Error('Please rate '+m.label+'.');
        measurements[m.key]=null;
      }else{
        const value=Number(raw);
        if(!Number.isInteger(value)||value<0||value>10)throw new Error('Invalid '+m.label+' rating.');
        measurements[m.key]=value;
      }
    }
    for(const key of ['disagreements','tensionEpisodes','angerEpisodes'])
      measurements[key]=requiredInt(key);
    measurements.sleepHours=optionalNumber('sleepHours',24,0.5);
    measurements.togetherMinutes=optionalNumber('togetherMinutes',1440,1);
    measurements.notes=$('diaryNotes').value.trim().slice(0,2000)||null;
    const moment=new Date().toISOString();
    await persist(data=>{
      const old=data.diaries.find(r=>r.personId===personId&&r.day===day);
      const entry={id:old?.id||crypto.randomUUID(),personId,day,...measurements,
        createdAt:old?.createdAt||moment,updatedAt:moment};
      if(old){
        const idx=data.diaries.findIndex(r=>r.id===old.id);data.diaries[idx]=entry;
        data.audit.push({id:crypto.randomUUID(),at:moment,action:'revise_diary',personId,recordId:entry.id,old});
      }else data.diaries.push(entry);
    },'Daily observation saved in your encrypted research vault.');
  }));
  $('deleteDiary').addEventListener('click',e=>perform(e,async()=>{
    throwIfStopped();
    const old=selectedEntry();
    if(!old)return;
    if(!confirm('Delete this daily observation? This action is recorded in the revision history.'))return;
    await persist(data=>{
      data.diaries=data.diaries.filter(r=>r.id!==old.id);
      data.audit.push({id:crypto.randomUUID(),at:new Date().toISOString(),
        action:'delete_diary',personId,recordId:old.id,old});
    },'Daily observation deleted; an audit record was saved.');
  }));
  $('eventForm').addEventListener('submit',e=>perform(e,async()=>{
    throwIfStopped();
    const raw=$('eventWhen').value;
    const dt=new Date(raw);
    if(!raw||!Number.isFinite(dt.getTime())||dt.getTime()>Date.now())
      throw new Error('Enter a valid event date and time that is not in the future.');
    const day=localDay(dt,vault.study.timezone);
    if(day<vault.study.start)throw new Error('Event must fall on or after November 13, 2026.');
    const type=$('eventType').value;
    if(!kinds[type])throw new Error('Choose a valid event category.');
    const severity=requiredInt('eventSeverity',10),durationMinutes=requiredInt('eventDuration',1440);
    const context=$('eventContext').value.trim().slice(0,1000);
    await persist(data=>{
      data.events.push({id:crypto.randomUUID(),personId,type,occurredAt:dt.toISOString(),
        severity,durationMinutes,context,createdAt:new Date().toISOString()});
    },'Event saved to your encrypted timeline.');
    $('eventContext').value='';
  }));
  $('stopForm').addEventListener('submit',e=>perform(e,async()=>{
    throwIfStopped();
    const reason=$('stopReason').value;
    if(!boundReasons[reason])throw new Error('Choose the reason for stopping.');
    if(!confirm('End the observational period for both people? New records will be permanently disabled.'))return;
    const candidate=structuredClone(vault);
    candidate.study.status='stopped';
    candidate.study.stop={time:new Date().toISOString(),reason,reportedBy:personId};
    candidate.audit.push({id:crypto.randomUUID(),at:candidate.study.stop.time,
      action:'stop_study',personId,reason});
    await saveVault(candidate);
    vault=candidate;renderAll();openTab('protocol');
    flash('The observation is now stopped. Historical results and exports remain available.');
  }));
  $('exportBackup').addEventListener('click',e=>perform(e,async()=>{
    if(!vault)throw new Error('Unlock the vault first.');
    download('sakinah-research-encrypted-'+today()+'.json',await encryptedBackup(),'application/json');
    flash('Encrypted backup downloaded. Keep the passphrase in a safe place separate from the backup.');
  }));
  for(const [btn,kind,label] of [
    ['exportDiary','diaries','daily-diaries'],['exportEvents','events','episode-timeline']
  ]){
    $(btn).addEventListener('click',e=>perform(e,async()=>{
      if(!vault)throw new Error('Unlock your vault first.');
      download('sakinah-'+label+'-'+today()+'.csv','\ufeff'+csvFromVault(vault,kind),'text/csv;charset=utf-8');
      flash('CSV exported. Unlike the encrypted backup, this CSV is readable plaintext—store it securely.');
    }));
  }
  $('importBackup').addEventListener('change',e=>perform(e,async()=>{
    if(await hasVault())throw new Error('A vault already exists in this browser. Import is disabled to prevent overwriting it.');
    const file=e.target.files?.[0];
    if(!file)return;
    if(file.size>12*1024*1024)throw new Error('Backup exceeds the 12 MB import limit.');
    if(!confirm('Import this encrypted backup into the empty browser vault?'))return;
    await restoreBackup(await file.text());
    $('createForm').querySelector('button[type=submit]').disabled=true;
    $('createForm').querySelector('button[type=submit]').textContent='A vault already exists on this browser';
    e.target.value='';
    flash('Encrypted backup imported. Unlock it with its original passphrase.');
  }));
  $('deleteVaultButton').addEventListener('click',e=>perform(e,async()=>{
    if(!vault)throw new Error('Unlock the vault first.');
    const reply=prompt('This deletes your entire research database from this browser. Type DELETE to confirm.');
    if(reply!=='DELETE')return;
    await deleteVault();
    vault=null;personId=null;activateUI();
    $('createForm').querySelector('button[type=submit]').disabled=false;
    $('createForm').querySelector('button[type=submit]').textContent='Create research vault ↗';
    flash('Local encrypted research vault deleted.');
  }));
}
async function init(){
  setupHandlers();
  const existing=await hasVault();
  if(existing){
    $('createForm').querySelector('button[type=submit]').disabled=true;
    const p=$('createForm').querySelector('button[type=submit]');
    p.textContent='A vault already exists on this browser';
    flash('An encrypted vault exists here. Unlock it to continue.');
  }
}
init().catch(err=>{console.error(err);flash('Could not initialize the research database: '+err.message,true);});
