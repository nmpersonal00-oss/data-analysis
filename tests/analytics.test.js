import test from 'node:test';
import assert from 'node:assert/strict';
import {localDay,dayCount,mean,median,standardDeviation,summarize,csvFromVault,
  dailyTrajectory} from '../analytics.js';

const people=[{id:'a',name:'A',code:'A'},{id:'b',name:'B',code:'B'}];
function makeStudy(overrides={}){
  return {id:'example',version:'1.0.0',start:'2026-11-13',
    timezone:'America/Los_Angeles',status:'active',stop:null,...overrides};
}
function makeVault(diaries=[],study=makeStudy()){
  return {study,participants:people,diaries,events:[],audit:[]};
}
function day(id,date,changes={}){
  return {id:id+date,personId:id,day:date,calm:8,tension:2,anger:1,
    happiness:8,closeness:8,communication:null,externalStress:null,
    disagreements:0,tensionEpisodes:0,angerEpisodes:0,
    sleepHours:null,togetherMinutes:null,notes:null,
    createdAt:'2026-11-13T22:00:00Z',updatedAt:'2026-11-13T22:00:00Z',...changes};
}
test('California reporting day differs from UTC near midnight',()=>{
  assert.equal(localDay('2026-11-14T05:30:00Z','America/Los_Angeles'),'2026-11-13');
});
test('inclusive expected dates',()=>{
  assert.equal(dayCount('2026-11-13','2026-11-13'),1);
  assert.equal(dayCount('2026-11-13','2026-11-16'),4);
  assert.equal(dayCount('2026-11-16','2026-11-13'),0);
});
test('means medians and sample SD are empty safe',()=>{
  assert.equal(mean([]),null);assert.equal(median([]),null);
  assert.equal(standardDeviation([5]),null);
  assert.equal(mean([1,3]),2);assert.equal(median([1,9,3]),3);
  assert.equal(standardDeviation([1,3]),Math.sqrt(2));
});
test('missing days not zero-coded',()=>{
  const s=summarize(makeVault([]),'a',new Date('2026-11-14T06:00:00Z'));
  assert.equal(s.expected,1);assert.equal(s.recorded,0);
  assert.equal(s.missing,1);assert.equal(s.scores.calm.mean,null);
  assert.equal(s.episodes.angerEpisodes.total,null);
});
test('completeness and episode frequencies only use recorded days',()=>{
  const study=makeStudy({status:'stopped',stop:{
    time:'2026-11-16T12:00:00Z',reason:'voluntary',reportedBy:'a'
  }});
  const vault=makeVault([day('a','2026-11-13',{calm:10,disagreements:1,tensionEpisodes:2}),
    day('a','2026-11-15',{calm:6,disagreements:0,tensionEpisodes:1}),
    day('b','2026-11-13',{calm:0})],study);
  const stats=summarize(vault,'a',new Date('2026-11-22T00:00:00Z'));
  assert.equal(stats.expected,4);assert.equal(stats.recorded,2);
  assert.equal(stats.missing,2);assert.equal(stats.completeness,50);
  assert.equal(stats.scores.calm.mean,8);
  assert.equal(stats.episodes.disagreements.total,1);
  assert.equal(stats.episodes.tensionEpisodes.total,3);
  assert.equal(stats.episodes.tensionEpisodes.meanPerRecordedDay,1.5);
});
test('daily trajectories exclude other people when requested',()=>{
  const vault=makeVault([day('a','2026-11-13',{calm:7}),day('b','2026-11-13',{calm:3})]);
  assert.equal(dailyTrajectory(vault,'calm',['a']).length,1);
});
test('CSV avoids spreadsheet formula execution and exports headers',()=>{
  const csv=csvFromVault(makeVault([day('a','2026-11-13',{notes:'=HYPERLINK("example")'})]));
  assert.ok(csv.includes('tensionEpisodes'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.equal(csv.trimEnd().split('\r\n').length,2);
});
