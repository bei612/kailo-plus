import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { setup, mcpWireClient } from './query-revision.test.mjs';
import { canonical } from '../src/query-revision.mjs';

const adapterIds = Array.from({length:12}, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const deleteKey = 'file_storage.delete@v1';
const deleteArguments = permanent => ({target:{resourceId:adapterIds[10]},input:{resourceId:adapterIds[10],
  nativeObjectRefs:[adapterIds[3],adapterIds[2]],removePermanently:permanent}});
const completedDelete = () => ({execution:{idempotencyKey:adapterIds[7],nativeType:'job',nativeId:adapterIds[7],
  platformStatus:'SUCCEEDED',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z',terminalAt:'2026-10-09T00:00:00Z'}});

test('governed native deletion preserves permanent/recycle and HUMAN/AGENT identity without treating dispatch as completion',async t=>{
  for (const businessHuman of [true,false]) for (const permanent of [true,false]) await t.test(`${businessHuman}/${permanent}`,async nested=>{
    const f=await setup(nested,{delete:true,validation:true,operation:'execute',businessHuman,businessAction:deleteKey,arguments:deleteArguments(permanent)});
    const result=await f.invoke({path:'/platform-adapter/v1/execute',key:adapterIds[7],raw:canonical({actionKey:deleteKey,idempotencyKey:adapterIds[7],arguments:f.requestArguments})});
    assert.equal(result.status,200);
    assert.equal((await result.json()).execution.platformStatus,'UNKNOWN');
    assert.equal(f.state.deletions,1);assert.equal(f.state.peps,2);
    assert.deepEqual(f.state.nativeReads,['/v2/n/action/delete']);
  });
});

test('delete observation and count usage consume original terminal Task, never resubmit or invent bytes',async t=>{
  for (const operation of ['observe','extract_usage']) for (const businessHuman of [true,false]) await t.test(`${operation}/${businessHuman}`,async nested=>{
    const f=await setup(nested,{delete:true,validation:true,operation,businessHuman,businessAction:deleteKey,deleteResult:completedDelete(),
      arguments:{externalExecutionId:adapterIds[8],idempotencyKey:adapterIds[7],nativeType:'job'}});
    const result=await f.invoke({path:`/platform-adapter/v1/${operation}`});assert.equal(result.status,200);
    const value=await result.json();
    if (operation==='observe') assert.deepEqual(value,{...completedDelete(),resultJson:'{}'});
    else assert.deepEqual(value,{externalExecutionId:adapterIds[8],idempotencyKey:adapterIds[7],nativeType:'job',nativeId:adapterIds[7],
      measurements:[{meterKey:'approved_delete_count',quantity:1,occurredAt:'2026-10-09T00:00:00Z'}]});
    assert.equal(f.state.deletions,undefined);assert.equal(f.state.deleteObservations,1);assert.equal(f.state.peps,2);
  });
  const f=await setup(t,{delete:true,validation:true,operation:'extract_usage',businessAction:deleteKey,
    arguments:{externalExecutionId:adapterIds[8],idempotencyKey:adapterIds[7],nativeType:'job'}});
  assert.equal((await f.invoke({path:'/platform-adapter/v1/extract_usage'})).status,503);
  assert.equal(f.state.deletions,undefined);
});

test('native delete uses the original Gateway MCP transport and the same governed executor',async t=>{
  for (const businessHuman of [true,false]) await t.test(`${businessHuman}`,async nested=>{
    const f=await setup(nested,{delete:true,mcp:true,validation:true,operation:'execute',businessHuman,
      businessAction:deleteKey,arguments:deleteArguments(false)});
    const {client,outgoing}=await mcpWireClient(nested,f);
    const tools=await client.listTools();assert.equal(tools.tools.length,1);
    outgoing.authorization=`Bearer ${f.token()}`;outgoing['idempotency-key']=adapterIds[7];
    const response=await client.callTool({name:tools.tools[0].name,arguments:f.requestArguments.input});
    assert.equal(response.isError,false);assert.deepEqual(response.content,[]);
    assert.equal(response.structuredContent.execution.platformStatus,'UNKNOWN');
    assert.equal(f.state.deletions,1);assert.equal(f.state.peps,2);
  });
});

test('delete refuses ambiguous input, forged terminal evidence, missing actor ACK and revoked post-dispatch access',async t=>{
  for (const scenario of ['empty','duplicate','foreign-resource','extra-field','missing-ee','missing-key','missing-actor','wrong-key','missing-terminal','unknown-status','unconfirmed-id','unexpected-body','revoked']) await t.test(scenario,async nested=>{
    const args=deleteArguments(false), native=completedDelete();
    if (scenario==='empty') args.input.nativeObjectRefs=[];
    if (scenario==='duplicate') args.input.nativeObjectRefs=[adapterIds[3],adapterIds[3]];
    if (scenario==='foreign-resource') args.input.resourceId=adapterIds[0];
    if (scenario==='extra-field') args.input.content='forbidden';
    if (scenario==='wrong-key') native.execution.idempotencyKey=adapterIds[0];
    if (scenario==='missing-terminal') delete native.execution.terminalAt;
    if (scenario==='unknown-status') native.execution.platformStatus='FUTURE';
    if (scenario==='unconfirmed-id') native.execution.platformStatus='UNKNOWN';
    if (scenario==='unexpected-body') native.body='forbidden';
    const f=await setup(nested,{delete:true,validation:true,operation:'execute',businessAction:deleteKey,arguments:args,
      deleteResult:native,missingActorAck:scenario==='missing-actor',
      ...(scenario==='revoked'?{pep:(state,response)=>{
        response.writeHead(state.peps===1?200:403,{'content-type':'application/json'});
        response.end(JSON.stringify({actionExecutionId:adapterIds[7],operationId:adapterIds[6],authorizationMinZedToken:'fresh',
          targetResource:{resourceId:adapterIds[10],nativeType:'folder',nativeRef:adapterIds[2],nativeInstanceRef:'delivered-instance',nativeScopeRef:adapterIds[1]}}));
      }}:{})});
    const token=f.token(scenario==='missing-ee'?{external_execution_id:undefined}:scenario==='missing-key'?{idempotency_key:undefined}:{});
    const result=await f.invoke({path:'/platform-adapter/v1/execute',key:adapterIds[7],token,
      raw:canonical({actionKey:deleteKey,idempotencyKey:adapterIds[7],arguments:args})});
    assert.notEqual(result.status,200);assert.deepEqual(await result.json(),{error:'adapter request refused'});
    assert((f.state.deletions??0)<=1);
  });
});

const source = (await readFile(new URL('../../frontend/assets/access.gateway/res/js/callback/nativeDelete.js', import.meta.url), 'utf8'))
  .replace("import PydioApi from 'pydio/http/api'", '')
  .replace("import uuid4 from 'uuid4'", '')
  .replace('export default async function nativeDelete', 'async function nativeDelete');
const ids = Array.from({length:6}, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);

function fixture(storage = new Map()) {
  const state = { calls:[], messages:[], generation:1, status:202, terminal:undefined, unavailable:false, nodes:true, failStorage:false };
  const user = {id:ids[0], getActiveRepository:() => ids[1]};
  const pydio = {user, MessageHash:{391:'refused', 'action.delete.unknown':'unknown', 'action.delete.awaiting-admission':'approval'},
    UI:{displayMessage:(type, message) => state.messages.push({type,message})}};
  const client = {basePath:'/a', defaultHeaders:{}, getOrUpdateJwt:async () => 'native-user-token'};
  const storageApi = {getItem:key => storage.get(key), removeItem:key => storage.delete(key),
    setItem:(key,value) => {if (state.failStorage) throw new Error('storage refused'); storage.set(key,value);}};
  const fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    state.calls.push({url, body, headers:request.headers});
    if (url.endsWith('/tree/stats')) {
      if (state.unavailable) throw new Error('native metadata unavailable');
      return {ok:true, status:200, headers:new Map([['X-Kailo-Native-Delete-Binding', JSON.stringify({bindingId:ids[2],generation:state.generation,tenantId:ids[3]})]]),
        json:async () => ({Nodes:state.nodes ? body.NodePaths.map((Path,i) => ({Path,Uuid:ids[4+i]})) : []})};
    }
    if (state.status === 'lost') throw new Error('lost native reply');
    return {status:state.status, json:async () => state.status===200 ? {} : {
      submission:{dispatchState:state.status===202?'UNKNOWN':'NOT_DISPATCHED'}, ...(state.terminal ? {terminalStatus:state.terminal} : {})}};
  };
  const nativeDelete = runInNewContext(`${source}; nativeDelete`, {PydioApi:{getRestClient:()=>client}, uuid4:()=>ids[5], URL,
    document:{location:{origin:'https://native.test',href:'https://native.test/'}}, localStorage:storageApi, fetch});
  const request = {Nodes:[{Path:'documents/item'}],RemovePermanently:false};
  return {state, storage, pydio, request, invoke:() => nativeDelete(pydio, request), nativeDelete};
}

test('original delete retains selection and original key across lost ACK and browser reload', async () => {
  const first = fixture();
  first.state.status='lost';
  assert.equal(await first.invoke(), null);
  assert.equal(first.storage.size,1);
  assert.deepEqual(first.state.messages,[{type:'INFO',message:'unknown'}]);
  const original = first.state.calls.at(-1);
  assert.equal(original.headers['Idempotency-Key'],ids[5]);
  assert.equal(original.body.Nodes[0].Uuid,ids[4]);
  assert.equal([...first.storage.values()][0].includes('native-user-token'),false);
  const reopened = fixture(first.storage);
  reopened.state.nodes=false; // Deleted native paths are not a reason to repeat the effect.
  assert.equal(await reopened.invoke(),null);
  assert.equal(reopened.state.calls.at(-1).headers['Idempotency-Key'],original.headers['Idempotency-Key']);
  assert.deepEqual(reopened.state.calls.at(-1).body,original.body);
  assert.equal(reopened.storage.size,1);
  reopened.state.status=200;
  assert.deepEqual(JSON.parse(JSON.stringify(await reopened.invoke())),{});
  assert.equal(reopened.storage.size,0);
});

test('a pending old binding generation is retained without another delete request', async () => {
  const f=fixture(); await f.invoke();
  const frozen=[...f.storage.entries()];
  f.state.generation++;
  assert.equal(await f.invoke(),null);
  assert.equal(f.state.calls.filter(call=>call.url.endsWith('/tree/delete')).length,1);
  assert.deepEqual([...f.storage.entries()],frozen);
  assert.deepEqual(f.state.messages.at(-1),{type:'INFO',message:'unknown'});
});

test('unreadable or unwritable browser intent refuses before deletion', async () => {
  const f=fixture(); f.state.failStorage=true;
  await assert.rejects(f.invoke());
  assert.equal(f.state.calls.filter(call=>call.url.endsWith('/tree/delete')).length,0);
  const malformed=fixture(); await malformed.invoke();
  malformed.storage.set([...malformed.storage.keys()][0],'{broken');
  const next=fixture(malformed.storage);
  await assert.rejects(next.invoke());
  assert.equal(next.state.calls.length,0);
});

test('pending observation metadata failure is UNKNOWN, not a failed delete or new key', async () => {
  const f=fixture(); await f.invoke(); const before=[...f.storage.entries()];
  f.state.unavailable=true;
  assert.equal(await f.invoke(),null);
  assert.deepEqual(f.state.messages.at(-1),{type:'INFO',message:'unknown'});
  assert.deepEqual([...f.storage.entries()],before);
});

test('only original Core terminal failure may retire a pending browser intent', async () => {
  const f=fixture(); await f.invoke();
  f.state.status=503;
  assert.equal(await f.invoke(),null);
  assert.equal(f.storage.size,1);
  f.state.status=202; f.state.terminal='FAILED';
  assert.equal(await f.invoke(),null);
  assert.equal(f.storage.size,0);
  assert.deepEqual(f.state.messages.at(-1),{type:'ERROR',message:'refused'});
});
