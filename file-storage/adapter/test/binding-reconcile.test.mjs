import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './query-revision.test.mjs';

test('binding reconcile consumes complete original native enumeration and exact ACK',async t=>{
  for(const scenario of ['complete','missing-ack','wrong-reference','unknown','terminal','duplicate','incomplete','pep-revoked','wrong-action']){
    await t.test(scenario,async nested=>{
      const observation={idempotencyKey:'00000000-0000-4000-8000-000000000099',nativeType:'job',nativeId:'00000000-0000-4000-8000-000000000099',nativeStatus:'Queued',platformStatus:'UNKNOWN',cancelCapability:'UNSUPPORTED',lastObservedAt:new Date().toISOString()};
      const changes={validation:true,bindingReconcile:true,operation:'reconcile',missingReconcileAck:scenario==='missing-ack'};
      if(scenario==='pep-revoked') changes.pep=(_state,response)=>{response.writeHead(403);response.end('{}')};
      const f=await setup(nested,changes);
      const result={reference:f.requestArguments,complete:true,observations:[]};
      if(scenario==='wrong-reference')result.reference={...result.reference,generation:1};
      if(scenario==='incomplete')result.complete=false;
      if(['unknown','terminal','duplicate'].includes(scenario))result.observations=[observation];
      if(scenario==='terminal'){observation.platformStatus='SUCCEEDED';observation.nativeStatus='Finished';observation.terminalAt=observation.lastObservedAt}
      if(scenario==='duplicate')result.observations.push(observation);
      changes.bindingObservation=result;
      const response=await f.invoke({path:'/platform-adapter/v1/reconcile',token:f.token({action_key:scenario==='wrong-action'?'application_binding.upgrade':'application_binding.disable'})});
      if(['complete','unknown','terminal'].includes(scenario)){assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.equal(f.state.peps,2)}
      else assert.notEqual(response.status,200);
    });
  }
});
