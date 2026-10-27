import {test} from 'node:test';import assert from 'node:assert/strict';
import {menuGroups} from '../src/menu-groups.ts';
test('sidebar subcategories stay scoped to their parent and include newly typed groups',()=>{
 const links=[{category:'reports',group:'Outbound'},{category:'reports',group:'Daily'},{category:'reports',group:'Inbound'},{category:'reports',group:'Daily'},{category:'apps',group:'Internal'},{category:'reports',group:'Klaim'}];
 assert.deepEqual(menuGroups(links,'reports'),['Daily','Inbound','Outbound','Klaim']);assert.deepEqual(menuGroups(links,'apps'),['Internal']);assert.deepEqual(menuGroups(links,'empty'),[]);
});
test('stored empty submenus are available under every menu, including dedicated modules',()=>{
 const categories=[{id:'apps',submenus:['Vendor','Internal']},{id:'monitoring',submenus:[]},{id:'docs',submenus:['SOP']},{id:'handover',submenus:['Mitra']}];
 assert.deepEqual(menuGroups([],'apps',categories),['Internal','Vendor']);assert.deepEqual(menuGroups([],'docs',categories),['SOP']);assert.deepEqual(menuGroups([],'handover',categories),['Mitra']);assert.deepEqual(menuGroups([],'monitoring',categories),[]);
});
test('stored submenus combine with legacy link groups without adding obsolete module links',()=>{
 const links=[{category:'apps',group:'Internal'},{category:'apps',group:'Vendor'},{category:'docs',group:'Kelompok tautan lama'}];
 const categories=[{id:'apps',submenus:['Internal','Lainnya']},{id:'docs',submenus:['Panduan']}];
 assert.deepEqual(menuGroups(links,'apps',categories),['Internal','Lainnya','Vendor']);assert.deepEqual(menuGroups(links,'docs',categories),['Panduan']);
});
