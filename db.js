/* Encrypted local research database. No network requests. No other app storage is used. */
const DB_NAME='sakinah-research-vault-v1';
const STORE='vaults';
const KEY='primary';
const VERSION=1;
const enc=new TextEncoder(), dec=new TextDecoder();

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,VERSION);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open local database'));
  });
}
async function readRecord(){
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(KEY);
    r.onsuccess=()=>resolve(r.result||null);
    r.onerror=()=>reject(r.error);
  });}finally{db.close();}
}
function fromBase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
function toBase64(bytes){let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s);}
async function deriveKey(passphrase,salt){
  const base=await crypto.subtle.importKey('raw',enc.encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},base,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}
async function encrypt(data,key){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload=enc.encode(JSON.stringify(data));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,payload);
  return {iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ciphertext))};
}
async function decrypt(record,key){
  try{
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(record.iv)},key,fromBase64(record.ciphertext));
    const result=JSON.parse(dec.decode(bytes));
    if(!result||result.format!==1||!Array.isArray(result.diaries)||!Array.isArray(result.events))
      throw new Error('Invalid research data format');
    return result;
  }catch(error){throw new Error('Incorrect passphrase or damaged encrypted database');}
}

let unlockedKey=null, unlockedSalt=null, revision=null;
export async function hasVault(){return !!(await readRecord());}
export function isUnlocked(){return !!unlockedKey;}
export function lockVault(){unlockedKey=null;unlockedSalt=null;revision=null;}
export async function createVault(passphrase,personA,personB,timezone){
  if((passphrase||'').length<12)throw new Error('Use a passphrase with at least 12 characters.');
  if(!personA.trim()||!personB.trim())throw new Error('Enter both participant nicknames.');
  if(await hasVault())throw new Error('A research vault already exists on this browser. Unlock it instead.');
  const participants=[personA,personB].map((name,i)=>({id:crypto.randomUUID(),name:name.trim().slice(0,60),code:i?'B':'A'}));
  const value={
    format:1,study:{
      id:crypto.randomUUID(),
      title:'Personal observational study on physical boundaries and relationship tension',
      version:'1.0.0',
      start:'2026-11-13',
      timezone:timezone||'America/Los_Angeles',
      question:'Do we experience more calm and fewer episodes of tension or anger while maintaining the four boundaries?',
      hypothesis:'Calm increases, while disagreement, tension, and anger decrease.',
      status:'active',stop:null,createdAt:new Date().toISOString()
    },participants,diaries:[],events:[],audit:[]
  };
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await deriveKey(passphrase,salt);
  const wrapped=await encrypt(value,key);
  const db=await openDb();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
      store.add({id:KEY,format:1,revision:1,salt:toBase64(salt),...wrapped});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close();}
  unlockedKey=key;unlockedSalt=toBase64(salt);revision=1;
  return value;
}
export async function unlockVault(passphrase){
  const record=await readRecord();
  if(!record)throw new Error('There is no saved study in this browser.');
  const key=await deriveKey(passphrase,fromBase64(record.salt));
  const data=await decrypt(record,key);
  unlockedKey=key;unlockedSalt=record.salt;revision=record.revision;
  return data;
}
export async function saveVault(data){
  if(!unlockedKey)throw new Error('Unlock your research vault first.');
  const wrapped=await encrypt(data,unlockedKey);
  const db=await openDb();
  try {
    const next=await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
      const req=store.get(KEY);
      req.onsuccess=()=>{
        const old=req.result;
        if(!old||old.revision!==revision||old.salt!==unlockedSalt){
          tx.abort();reject(new Error('The vault changed in another tab. Reload and unlock to avoid overwriting data.'));
          return;
        }
        store.put({id:KEY,format:1,revision:revision+1,salt:unlockedSalt,...wrapped});
      };
      req.onerror=()=>reject(req.error);
      tx.oncomplete=()=>resolve(revision+1);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('Vault update was cancelled'));
    });
    revision=next;
  }finally{db.close();}
}
export async function encryptedBackup(){
  const record=await readRecord();
  if(!record)throw new Error('No study to back up');
  return JSON.stringify({app:'sakinah-research',backupFormat:1,exportedAt:new Date().toISOString(),vault:record},null,2);
}
export async function restoreBackup(text){
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw new Error('Not a valid JSON backup');}
  const r=parsed?.vault;
  if(parsed?.app!=='sakinah-research'||parsed?.backupFormat!==1||r?.id!==KEY||
     r?.format!==1||!Number.isInteger(r.revision)||!r.salt||!r.iv||!r.ciphertext)
    throw new Error('This is not a valid encrypted Sakinah research backup.');
  if(await hasVault())throw new Error('A vault already exists. Export it first, then remove it before importing another.');
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).add(r);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
  lockVault();
}
export async function deleteVault(){
  lockVault();
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
