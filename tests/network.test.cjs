const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function network(fetch, controller=AbortController) {
  const start=source.indexOf('async function fetchJSON(');
  const end=source.indexOf('async function findArchiveAudio(',start);
  assert.ok(start>=0 && end>start);
  const context=vm.createContext({fetch,AbortController:controller,setTimeout,clearTimeout});
  vm.runInContext(source.slice(start,end),context);
  return context.fetchJSON;
}
test('JSON success',async()=>{
  const fn=network(async()=>({ok:true,json:async()=>({value:42})}));
  assert.equal((await fn('https://example.test')).value,42);
});
test('timeout settles even without AbortController',async()=>{
  const fn=network(()=>new Promise(()=>{}),null);
  await assert.rejects(fn('https://example.test',{timeout:10}),{name:'TimeoutError'});
});
test('abort cancels pending request',async()=>{
  const fn=network((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{const error=new Error('cancelled');error.name='AbortError';reject(error);}))); 
  const controller=new AbortController();
  const pending=fn('https://example.test',{signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
});
test('HTTP failure does not read response body',async()=>{
  const fn=network(async()=>({ok:false,status:503,json:()=>{throw new Error('unexpected body');}}));
  await assert.rejects(fn('https://example.test'),/Источник временно недоступен/);
});
test('queue rejects duplicate IDs including same batch',()=>{
  const start=source.indexOf('function add(list, favorite=false)');
  const end=source.indexOf('function entry(',start);
  const context=vm.createContext({queue:[{id:'existing'}],imported:[],liked:[],save(){},updateCounts(){},toast(){}});
  vm.runInContext(source.slice(start,end),context);
  context.add([{id:'existing'},{id:'new'},{id:'new'}]);
  assert.deepEqual(Array.from(context.queue,t=>t.id),['existing','new']);
});
