import {createServer} from 'node:http';
import app from './app';
import {attachEdgeWebSocket} from '../archive/vernatun/server/edge-sockets';

// Shared by the deployed entrypoint and Edge integration tests so a test-only
// upgrade listener cannot hide missing production WebSocket wiring.
export function createApiServer(){
 const server=createServer(app);
 const edgeSockets=attachEdgeWebSocket(server);
 return {server,edgeSockets};
}
