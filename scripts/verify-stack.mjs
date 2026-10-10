#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
function run(args) {
  const r = spawnSync('docker', ['compose', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'Docker command failed');
  return r.stdout;
}
const key = `verification:${randomUUID()}`;
const code = `const {BusService}=require('./dist/redis/bus.service');
const bus=new BusService();
(async()=>{for(let i=0;!bus.isHealthy&&i<100;i++)await new Promise(r=>setTimeout(r,50));
if(!bus.isHealthy)throw Error('Redis unavailable');
const result=await bus.hit(${JSON.stringify(key)},1,30);
console.log('CHECK:'+JSON.stringify(result));await bus.onModuleDestroy();
})().catch(e=>{console.error(e);process.exit(1)});`;
const results = [1, 2].map(index => {
  const output = run(['exec', '-T', '--index', String(index), 'app', 'node', '-e', code]);
  return JSON.parse(output.split('CHECK:')[1].split('\n')[0]);
});
if (!results[0].allowed || results[1].allowed || results[1].count !== 2) throw new Error('Shared limiter failed');
const pubsub = run(['exec', '-T', 'redis', 'redis-cli', '--raw', 'PUBSUB', 'NUMSUB', 'mc2026:events']);
if (Number(pubsub.trim().split(/\s+/).at(-1)) < 2) throw new Error('Missing replica subscriptions');
run(['exec', '-T', 'redis', 'redis-cli', 'DEL', `mc2026:rl:${key}`]);
// Exercise the compiled application bus across containers, using an ignored test event.
const subscriberCode = `const {BusService}=require('./dist/redis/bus.service');const b=new BusService();
(async()=>{for(let i=0;(!b.isHealthy||b.sub.status!=='ready')&&i<100;i++)await new Promise(r=>setTimeout(r,50));
await b.sub.subscribe('mc2026:events');
b.on('verification',async p=>{if(p.key===${JSON.stringify(key)}){console.log('RECEIVED');await b.onModuleDestroy();}});
console.log('SUBSCRIBED');})().catch(e=>{console.error(e);process.exit(1)});`;
const subscriber = spawn('docker', ['compose', 'exec', '-T', '--index', '2', 'app', 'node', '-e', subscriberCode]);
await new Promise((resolve, reject) => {
  let output = '', published = false;
  subscriber.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => { subscriber.kill(); reject(new Error('Cross-replica update timed out')); }, 15000);
  subscriber.on('error', reject);
  subscriber.stdout.on('data', data => {
    output += data;
    if (output.includes('SUBSCRIBED') && !published) {
      published = true;
      try { run(['exec', '-T', '--index', '1', 'app', 'node', '-e', `const {BusService}=require('./dist/redis/bus.service');const b=new BusService();(async()=>{for(let i=0;!b.isHealthy&&i<100;i++)await new Promise(r=>setTimeout(r,50));if(!b.isHealthy)throw Error('Redis unavailable');await b.publish('verification',{key:${JSON.stringify(key)}});await b.onModuleDestroy()})().catch(()=>process.exit(1));`]); }
      catch (error) { clearTimeout(timer); subscriber.kill(); reject(error); }
    }
  });
  subscriber.on('close', code => { clearTimeout(timer); code === 0 && output.includes('RECEIVED') ? resolve() : reject(new Error(`Cross-replica update failed: ${output}`)); });
});
run(['exec', '-T', 'app', 'node', '-e', `process.env.REDIS_URL='';const {BusService}=require('./dist/redis/bus.service');const b=new BusService();(async()=>{const a=await b.hit('verification',1,30),c=await b.hit('verification',1,30);if(!a.allowed||c.allowed)throw Error('Fallback failed');await b.onModuleDestroy()})().catch(()=>process.exit(1));`]);
for (const index of [1, 2]) {
  run(['exec', '-T', '--index', String(index), 'app', 'node', '-e', "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)})"]);
}
console.log('PASS: both replicas healthy; shared rate limit; cross-replica live event delivered; local limiter fallback.');
