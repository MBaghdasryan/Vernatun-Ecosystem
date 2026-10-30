import {AccessToken,RoomServiceClient,TrackSource,TrackType,type VideoGrant} from 'livekit-server-sdk';

export type MediaViewerToken={serverUrl:string;joinToken:string;tokenExpiresAt:string};
export interface CameraMediaGateway{
 configured:boolean;
 serverUrl:string|null;
 createRoom(roomName:string):Promise<void>;
 createPublisherToken(roomName:string,identity:string):Promise<string>;
 createViewerToken(roomName:string,identity:string):Promise<MediaViewerToken>;
 hasVideoPublisher(roomName:string,identity:string):Promise<boolean>;
 deleteRoom(roomName:string):Promise<void>;
}

function normalizedServerUrl(value:string|undefined){
 if(!value)return null;
 try{
  const url=new URL(value);
  if(!['wss:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)return null;
  return url.toString().replace(/\/$/,'');
 }catch{return null}
}

class LiveKitCloudGateway implements CameraMediaGateway{
 readonly serverUrl:string|null;
 readonly configured:boolean;
 private readonly apiKey:string;
 private readonly apiSecret:string;
 private readonly rooms:RoomServiceClient|null;
 constructor(){
  this.serverUrl=normalizedServerUrl(process.env.LIVEKIT_URL);
  this.apiKey=process.env.LIVEKIT_API_KEY??'';
  this.apiSecret=process.env.LIVEKIT_API_SECRET??'';
  this.configured=!!(this.serverUrl&&this.apiKey&&this.apiSecret);
  this.rooms=this.configured?new RoomServiceClient(this.serverUrl!,this.apiKey,this.apiSecret):null;
 }
 private assertConfigured(){
  if(!this.configured||!this.serverUrl||!this.rooms)throw new Error('media_provider_not_configured');
 }
 async createRoom(roomName:string){
  this.assertConfigured();
  await this.rooms!.createRoom({name:roomName,emptyTimeout:60,departureTimeout:15,maxParticipants:12});
 }
 async createPublisherToken(roomName:string,identity:string){
  this.assertConfigured();
  const token=new AccessToken(this.apiKey,this.apiSecret,{identity,ttl:'5m'});
  const grant:VideoGrant={room:roomName,roomJoin:true,canPublish:true,canSubscribe:false,canPublishData:false,canPublishSources:[TrackSource.CAMERA]};
  token.addGrant(grant);
  return token.toJwt();
 }
 async createViewerToken(roomName:string,identity:string):Promise<MediaViewerToken>{
  this.assertConfigured();
  const token=new AccessToken(this.apiKey,this.apiSecret,{identity,ttl:'5m'});
  const grant:VideoGrant={room:roomName,roomJoin:true,canPublish:false,canSubscribe:true,canPublishData:false};
  token.addGrant(grant);
  const joinToken=await token.toJwt();
  return {serverUrl:this.serverUrl!,joinToken,tokenExpiresAt:new Date(Date.now()+5*60_000).toISOString()};
 }
 async hasVideoPublisher(roomName:string,identity:string){
  this.assertConfigured();
  const result=await this.rooms!.listParticipants(roomName);
  const participant=result.find(item=>item.identity===identity);
  return !!participant?.tracks?.some(track=>track.type===TrackType.VIDEO&&track.source===TrackSource.CAMERA);
 }
 async deleteRoom(roomName:string){
  this.assertConfigured();
  await this.rooms!.deleteRoom(roomName);
 }
}

export const cameraMediaGateway:CameraMediaGateway=new LiveKitCloudGateway();
