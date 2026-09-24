import test from 'node:test';
import assert from 'node:assert/strict';
import { Cockpit } from '../src/game/cockpit.js';

function fixture({fine=true, supported=true, request}={}) {
  const calls={request:0,exit:0,focus:0,clear:0,pauses:[],toasts:[]};
  const document=new EventTarget();
  const canvas={focus:()=>calls.focus++};
  const button={hidden:false,disabled:false,attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
  const note={hidden:true};
  document.pointerLockElement=null;
  document.getElementById=()=>canvas;
  document.exitPointerLock=()=>{calls.exit++;document.pointerLockElement=null;document.dispatchEvent(new Event('pointerlockchange'));};
  if(supported)canvas.requestPointerLock=()=>{
    calls.request++;
    if(request)return request();
    document.pointerLockElement=canvas;document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
  Object.assign(globalThis,{document,matchMedia:()=>({matches:fine})});
  const cockpit=Object.create(Cockpit.prototype);
  Object.assign(cockpit,{
    toolbar:{querySelector:selector=>selector.includes('data-flight-action')?button:note},paused:false,
    clearInput:()=>calls.clear++,
    pause(reason){this.paused=true;calls.pauses.push(reason);if(document.pointerLockElement)document.exitPointerLock();},
    toast:message=>calls.toasts.push(message),
  });
  cockpit.setupMouseCapture();
  return {cockpit,calls,document,canvas,button,note};
}

test('mouse capture only starts after the explicit action and focuses the flight canvas',()=>{
  const {cockpit,calls,button,note}=fixture();
  assert.equal(calls.request,0);assert.equal(note.hidden,true);
  cockpit.toggleMouseCapture();
  assert.equal(calls.request,1);assert.equal(calls.focus,1);assert.equal(calls.clear,1);
  assert.equal(cockpit.mouseCaptured,true);assert.equal(button.attributes['aria-pressed'],'true');
  assert.match(button.innerHTML,/Free cursor/);assert.equal(note.hidden,false);
});

test('freeing the mouse pauses once and restores the capture button',()=>{
  const {cockpit,calls,button,note}=fixture();
  cockpit.toggleMouseCapture();cockpit.toggleMouseCapture();
  assert.deepEqual(calls.pauses,['pointer']);assert.equal(calls.exit,1);
  assert.equal(cockpit.mouseCaptured,false);assert.equal(note.hidden,true);
  assert.equal(button.innerHTML,'Capture pointer');
});

test('a normal pause releasing pointer lock does not create another pause',()=>{
  const {cockpit,calls}=fixture();
  cockpit.toggleMouseCapture();cockpit.pause('manual');
  assert.deepEqual(calls.pauses,['manual']);assert.equal(calls.exit,1);
});

test('a pending lock resolving after pause is immediately released without a loop',()=>{
  const {cockpit,calls,document,canvas}=fixture({request:()=>undefined});
  cockpit.toggleMouseCapture();cockpit.paused=true;
  document.pointerLockElement=canvas;document.dispatchEvent(new Event('pointerlockchange'));
  assert.equal(calls.exit,1);assert.deepEqual(calls.pauses,[]);
  assert.equal(document.pointerLockElement,null);assert.equal(cockpit.mouseCaptured,false);
});

test('capture request failures report a useful fallback once and re-enable the button',async()=>{
  const {cockpit,calls,document,button}=fixture({request:()=>Promise.reject(new Error('denied'))});
  cockpit.toggleMouseCapture();await Promise.resolve();
  document.dispatchEvent(new Event('pointerlockerror'));
  assert.equal(calls.toasts.length,1);assert.match(calls.toasts[0],/free cursor/);
  assert.equal(button.disabled,false);assert.equal(cockpit.capturePending,false);
});

test('unsupported or touch-only environments do not advertise mouse capture',()=>{
  assert.equal(fixture({supported:false}).button.hidden,true);
  assert.equal(fixture({fine:false}).button.hidden,true);
});

test('pause and other menus never request pointer capture',()=>{
  const {cockpit,calls}=fixture();cockpit.paused=true;cockpit.toggleMouseCapture();
  assert.equal(calls.request,0);
});
