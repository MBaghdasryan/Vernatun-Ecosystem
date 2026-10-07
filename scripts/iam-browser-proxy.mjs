// Local-only QA bridge: stream browser requests instead of serializing them
// through the browser driver's interception API. Never forwards /api to main.
import http from 'node:http';
import net from 'node:net';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const meta=JSON.parse(await readFile('.local/qa/phase8-browser.json','utf8'));
const api=new URL(meta.url),web=new URL('http://127.0.0.1:23227');
if(api.hostname!=='127.0.0.1'||!/^qa_[a-f0-9]{20}$/.test(meta.schema))throw new Error('Isolated QA API required');
const server=http.createServer((req,res)=>{
 const isApi=/^\/api(?:\/|$)/.test(req.url??'');
 const target=isApi?api:web;
 const headers={...req.headers,host:target.host};
 if(isApi){headers.origin=meta.origin;headers.referer=meta.origin+'/';}
 const upstream=http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers},r=>{
  res.writeHead(r.statusCode??502,r.headers);r.pipe(res);
 });
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('QA upstream unavailable')});
 req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
 const upstream=net.connect(Number(web.port),web.hostname,()=>{
  upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
  if(head.length)upstream.write(head);
  socket.pipe(upstream);upstream.pipe(socket);
 });
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
});
server.listen(0,'127.0.0.1',async()=>{
 const url='http://127.0.0.1:'+server.address().port;
 await writeFile('.local/qa/iam-browser-proxy.json',JSON.stringify({url,schema:meta.schema}));
 console.log('Isolated IAM browser bridge ready:',url);
});
async function stop(){await unlink('.local/qa/iam-browser-proxy.json').catch(()=>{});server.close();server.closeAllConnections();process.exit(0)}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
