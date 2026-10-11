import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const source=(await readFile(new URL('../../frontend/assets/action.share/res/js/dialog/links/nativeRevoke.js',import.meta.url),'utf8'))
  .replace("import PydioApi from 'pydio/http/api'",'').replace("import uuid4 from 'uuid4'",'')
  .replace('export default async function nativeRevoke','async function nativeRevoke');
const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);

function fixture(storage=new Map()) {
  const state={calls:[],messages:[],status:202};
  const user={id:ids[0],getActiveRepository:()=>ids[1]};
  const pydio={user,MessageHash:{391:'refused','action.delete.unknown':'unknown','action.delete.awaiting-admission':'approval'},UI:{displayMessage:(type,message)=>state.messages.push({type,message})}};
  const client={basePath:'/a',defaultHeaders:{'X-CSRF-Token':'original-native-csrf'},getOrUpdateJwt:async()=>{if(state.switchUser)pydio.user={...user};return 'native-human';}};
  const revoke=runInNewContext(`${source};nativeRevoke`,{PydioApi:{getRestClient:()=>client},uuid4:()=>ids[5],URL,
    document:{location:{origin:'https://native.test',href:'https://native.test/'}},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>{if(state.storageError)throw Error('storage unavailable');storage.set(key,value);},removeItem:key=>storage.delete(key)},
    fetch:async(url,options)=>{state.calls.push({url,options});
      if(options.method==='GET')return {ok:true,status:200,headers:{get:()=>state.noDomain?null:JSON.stringify({bindingId:ids[3],tenantId:ids[4],generation:1})},json:async()=>({Uuid:ids[2]})};
      if(state.status==='lost')throw Error('lost ACK');
      return {status:state.status,json:async()=>state.status===200?{Success:true}:{submission:{dispatchState:state.dispatch||'UNKNOWN'},...(state.terminal?{terminalStatus:state.terminal}:{})}};
    }});
  return {state,storage,invoke:()=>revoke(pydio,ids[2])};
}

test('original share revoke keeps its key after lost ACK and reload observes the same action',async()=>{
  const original=fixture();original.state.status='lost';assert.equal(await original.invoke(),null);
  assert.equal(original.storage.size,1);
  const dispatched=original.state.calls.at(-1);
  assert.equal(dispatched.options.headers['X-CSRF-Token'],'original-native-csrf');
  assert.equal(dispatched.options.credentials,'same-origin');assert.equal(dispatched.options.redirect,'error');
  assert.equal([...original.storage.values()][0].includes('native-human'),false);
  const reopened=fixture(original.storage);reopened.state.status=200;
  assert.equal((await reopened.invoke()).Success,true);
  assert.equal(reopened.state.calls.length,1,'deleted native GET must not be a prerequisite for observing the owned request');
  assert.equal(reopened.state.calls[0].options.headers['Idempotency-Key'],dispatched.options.headers['Idempotency-Key']);
  assert.equal(reopened.storage.size,0);
});

test('share pending and partial failure never delete original dialog state or resubmit another action',async()=>{
  const pending=fixture();pending.state.dispatch='NOT_DISPATCHED';assert.equal(await pending.invoke(),null);
  assert.deepEqual(pending.state.messages,[{type:'INFO',message:'approval'}]);
  const key=pending.state.calls.at(-1).options.headers['Idempotency-Key'];
  pending.state.status=503;assert.equal(await pending.invoke(),null);
  assert.equal(pending.storage.size,1);assert.equal(pending.state.calls.at(-1).options.headers['Idempotency-Key'],key);
});

test('independent share retains native route while unavailable persistence or changed login cannot dispatch',async t=>{
  const independent=fixture();independent.state.noDomain=true;
  assert.equal(await independent.invoke(),undefined);assert.equal(independent.state.calls.length,1);assert.equal(independent.storage.size,0);
  for(const scenario of ['storage','login'])await t.test(scenario,async()=>{
    const f=fixture();if(scenario==='storage')f.state.storageError=true;else f.state.switchUser=true;
    await assert.rejects(f.invoke());assert.equal(f.state.calls.filter(x=>x.options.method==='DELETE').length,0);
  });
});
