import {test} from 'node:test';import assert from 'node:assert/strict';
import {menuGroups} from '../src/menu-groups.ts';
test('sidebar subcategories stay scoped to their parent and include newly typed groups',()=>{
 const links=[{category:'reports',group:'Outbound'},{category:'reports',group:'Daily'},{category:'reports',group:'Inbound'},{category:'reports',group:'Daily'},{category:'apps',group:'Internal'},{category:'reports',group:'Klaim'}];
 assert.deepEqual(menuGroups(links,'reports'),['Daily','Inbound','Outbound','Klaim']);assert.deepEqual(menuGroups(links,'apps'),['Internal']);assert.deepEqual(menuGroups(links,'empty'),[]);
});
