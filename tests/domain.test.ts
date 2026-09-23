import test from 'node:test';import assert from 'node:assert/strict';import {transition,canApprove,validateTypeDetails,requiredApprovalRole} from '../src/domain.js';
test('cannot activate before approvals',()=>assert.throws(()=>transition('APPROVED','activate',{allApproved:false})));
test('cannot activate before planned start',()=>assert.throws(()=>transition('APPROVED','activate',{allApproved:true,now:new Date(0),plannedStart:new Date(1)})));
test('expired is terminal',()=>assert.throws(()=>transition('EXPIRED','resume')));
test('area owner cannot self approve or approve outside their area',()=>{assert.equal(canApprove('AREA_OWNER','u','u','Utilities','Utilities'),false);assert.equal(canApprove('AREA_OWNER','r','a','Process','Utilities'),false)});
test('safety officer may approve any area but never own permit',()=>{assert.equal(canApprove('SAFETY_OFFICER','requester','safe','area-a',null),true);assert.equal(canApprove('SAFETY_OFFICER','safe','safe','area-a',null),false)});
test('approval roles are mapped to required approval slots',()=>{assert.equal(requiredApprovalRole('AREA_OWNER'),'AREA_OWNER');assert.equal(requiredApprovalRole('ADMIN'),'SAFETY_OFFICER');assert.equal(requiredApprovalRole('REQUESTER'),null)});
test('type-specific required fields are enforced',()=>{assert.throws(()=>validateTypeDetails('HOT_WORK',{hotWorkType:'Welding'}));assert.doesNotThrow(()=>validateTypeDetails('WORKING_AT_HEIGHT',{heightM:6,accessMethod:'Scaffold',fallArrestEquipment:'Harness',anchorPointChecked:true,barricadingBelow:true}))});
