import {test} from 'node:test';import assert from 'node:assert/strict';
import {createAuthChangeHandler} from '../src/auth-events.ts';
const session=id=>({user:{id}});
test('refocusing the same admin session refreshes data without resetting open forms',()=>{
 const changes=[];const auth=createAuthChangeHandler(reset=>changes.push(reset));
 auth('INITIAL_SESSION',session('admin-a'));
 auth('SIGNED_IN',session('admin-a'));auth('TOKEN_REFRESHED',session('admin-a'));auth('SIGNED_IN',session('admin-a'));
 assert.deepEqual(changes,[false,false]);
});
test('sign out and switching accounts reset forms so files and credentials do not leak',()=>{
 const changes=[];const auth=createAuthChangeHandler(reset=>changes.push(reset));
 auth('INITIAL_SESSION',null);auth('SIGNED_IN',session('admin-a'));auth('SIGNED_IN',session('admin-b'));auth('SIGNED_OUT',null);
 assert.deepEqual(changes,[true,true,true]);
});
test('late initial-session events do not overwrite a newer signed-in identity',()=>{
 const changes=[];const auth=createAuthChangeHandler(reset=>changes.push(reset));
 auth('SIGNED_IN',session('admin-a'));auth('INITIAL_SESSION',null);auth('SIGNED_IN',session('admin-a'));
 assert.deepEqual(changes,[true,false]);
});
