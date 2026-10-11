import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../../frontend/assets/gui.ajax/res/js/core/model/nativeCell.js', import.meta.url), 'utf8'))
  .replace("import PydioApi from '../http/PydioApi'", '')
  .replace("import uuid4 from 'uuid4'", '')
  .replace('export default async function nativeCell', 'async function nativeCell');
const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);

function fixture(storage=new Map()) {
  const state={calls:[],messages:[],generation:1,status:202,independent:0,storageError:false};
  const user={id:ids[0],getActiveRepository:()=>ids[1]};
  const pydio={user,MessageHash:{391:'refused','action.share.unknown':'unknown','action.share.awaiting-admission':'approval'},
    UI:{displayMessage:(type,message)=>state.messages.push({type,message})}};
  const request={Room:{Uuid:ids[2],Label:'Original cell',RootNodes:[{Uuid:ids[3]}],ACLs:{[ids[0]]:{Actions:[{Name:'read',Value:'1'}]}}}};
  const client={basePath:'/a',defaultHeaders:{},getOrUpdateJwt:async()=>{if(state.switchUser)pydio.user={...user};return 'native-human';}};
  const nativeCell=runInNewContext(`${source};nativeCell`,{PydioApi:{getRestClient:()=>client},uuid4:()=>ids[5],URL,
    document:{location:{origin:'https://native.test',href:'https://native.test/'}},
    localStorage:{getItem:key=>storage.get(key),removeItem:key=>storage.delete(key),setItem:(key,value)=>{if(state.storageError)throw Error('storage unavailable');storage.set(key,value);}},
    fetch:async(url,options)=>{
      state.calls.push({url,options});
      if(options.method==='GET')return {ok:true,status:200,headers:{get:()=>state.noDomain?null:JSON.stringify({bindingId:ids[4],generation:state.generation,tenantId:ids[1]})},json:async()=>request.Room};
      if(state.status==='lost')throw Error('lost ACK');
      return {status:state.status,json:async()=>state.status===200?request.Room:{submission:{dispatchState:state.dispatch||'UNKNOWN'},...(state.terminal?{terminalStatus:state.terminal}:{})}};
    }});
  const api={putCell:async()=>{state.independent++;return request.Room;}};
  return {state,storage,pydio,request,invoke:()=>nativeCell(pydio,request,api)};
}

test('original Cell save retains exact intent across lost ACK and browser reopen',async()=>{
  const first=fixture();first.state.status='lost';
  assert.equal(await first.invoke(),null);assert.equal(first.storage.size,1);
  const key=first.state.calls.at(-1).options.headers['Idempotency-Key'];
  assert.equal([...first.storage.values()][0].includes('native-human'),false);
  const reopened=fixture(first.storage);reopened.state.status=200;
  assert.equal((await reopened.invoke()).Uuid,ids[2]);
  assert.equal(reopened.state.calls.at(-1).options.headers['Idempotency-Key'],key);
  assert.equal(first.storage.size,0);
});

test('unknown Cell save cannot become a new request by editing selection or changing generation',async t=>{
  for(const scenario of ['generation','selection','missing-domain'])await t.test(scenario,async()=>{
    const first=fixture();await first.invoke();const old=[...first.storage.values()][0];
    const second=fixture(first.storage);
    if(scenario==='generation')second.state.generation=2;
    if(scenario==='selection')second.request.Room.Label='changed';
    if(scenario==='missing-domain')second.state.noDomain=true;
    assert.equal(await second.invoke(),null);assert.equal(second.state.calls.filter(x=>x.options.method==='PUT').length,0);
    assert.equal(second.state.independent,0);assert.equal([...second.storage.values()][0],old);
  });
});

test('original Cell approvals and lost results retain selection, while independent native save remains original',async()=>{
  const pending=fixture();pending.state.dispatch='NOT_DISPATCHED';
  assert.equal(await pending.invoke(),null);assert.equal(pending.storage.size,1);
  assert.deepEqual(pending.state.messages,[{type:'INFO',message:'approval'}]);
  const refused=fixture();refused.state.dispatch='NOT_DISPATCHED';refused.state.terminal='FAILED';
  assert.equal(await refused.invoke(),null);assert.equal(refused.storage.size,1);
  assert.deepEqual(refused.state.messages,[{type:'INFO',message:'unknown'}]);
  const native=fixture();native.state.noDomain=true;
  assert.equal((await native.invoke()).Uuid,ids[2]);assert.equal(native.state.independent,1);assert.equal(native.storage.size,0);
});

test('Cell save refuses unreadable persistence and login replacement before dispatch',async t=>{
  for(const scenario of ['storage','corrupt','login'])await t.test(scenario,async()=>{
    const f=fixture();
    if(scenario==='storage')f.state.storageError=true;
    if(scenario==='login')f.state.switchUser=true;
    if(scenario==='corrupt')f.storage.set(JSON.stringify(['native-cell-members','https://native.test',ids[0],ids[1],ids[2]]),'{bad');
    await assert.rejects(f.invoke());assert.equal(f.state.calls.filter(x=>x.options.method==='PUT').length,0);
    assert.equal(f.state.independent,0);
  });
});
