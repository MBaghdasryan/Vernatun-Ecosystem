import {AccessToken,IngressClient,IngressInput,RoomServiceClient,TrackSource,TrackType,type VideoGrant} from 'livekit-server-sdk';

export type MediaViewerToken={serverUrl:string;joinToken:string;tokenExpiresAt:string};
export type MediaPublisherSession={publishUrl:string;publisherToken:string};
export interface CameraMediaGateway{
 configured:boolean;
 serverUrl:string|null;
 createRoom(roomName:string):Promise<void>;
 createPublisherSession(roomName:string,identity:string):Promise<MediaPublisherSession>;
 createViewerToken(roomName:string,identity:string):Promise<MediaViewerToken>;
 hasVideoPublisher(roomName:string,identity:string):Promise<boolean>;
 deleteRoom(roomName:string):Promise<void>;
}

function normalizedUrls(value:string|undefined){
 if(!value)return null;
 try{
  const url=new URL(value);
  if(!['wss:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)return null;
  const serviceUrl=new URL(url.toString());
  const clientUrl=new URL(url.toString());
  serviceUrl.protocol='https:';
  clientUrl.protocol='wss:';
  return {
   serviceUrl:serviceUrl.toString().replace(/\/$/,''),
   clientUrl:clientUrl.toString().replace(/\/$/,''),
  };
 }catch{return null}
}

class LiveKitCloudGateway implements CameraMediaGateway{
 readonly serverUrl:string|null;
 readonly configured:boolean;
  private readonly serviceUrl:string|null;
 private readonly apiKey:string;
 private readonly apiSecret:string;
 private readonly rooms:RoomServiceClient|null;
  private readonly ingress:IngressClient|null;
 constructor(){
   const urls=normalizedUrls(process.env.LIVEKIT_URL);
   this.serverUrl=urls?.clientUrl??null;
   this.serviceUrl=urls?.serviceUrl??null;
  this.apiKey=process.env.LIVEKIT_API_KEY??'';
  this.apiSecret=process.env.LIVEKIT_API_SECRET??'';
   this.configured=!!(this.serverUrl&&this.serviceUrl&&this.apiKey&&this.apiSecret);
   this.rooms=this.configured?new RoomServiceClient(this.serviceUrl!,this.apiKey,this.apiSecret):null;
   this.ingress=this.configured?new IngressClient(this.serviceUrl!,this.apiKey,this.apiSecret):null;
 }
 private assertConfigured(){
  if(!this.configured||!this.serverUrl||!this.rooms)throw new Error('media_provider_not_configured');
 }
 async createRoom(roomName:string){
  this.assertConfigured();
  await this.rooms!.createRoom({name:roomName,emptyTimeout:60,departureTimeout:15,maxParticipants:12});
 }
  async createPublisherSession(roomName:string,identity:string):Promise<MediaPublisherSession>{
  this.assertConfigured();
   const ingress=await this.ingress!.createIngress(IngressInput.WHIP_INPUT,{
    name:`vernatun-${roomName}`,
    roomName,
    participantIdentity:identity,
    participantName:'Vernatun Edge Camera',
    enableTranscoding:false,
   });
   if(!ingress.url||!ingress.streamKey||!ingress.ingressId){
    if(ingress.ingressId)await this.ingress!.deleteIngress(ingress.ingressId).catch(()=>{});
    throw new Error('media_ingress_incomplete');
   }
   return {publishUrl:ingress.url,publisherToken:ingress.streamKey};
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
   let cleanupError:unknown;
   try{
    const ingresses=await this.ingress!.listIngress({roomName});
    for(const ingress of ingresses){
     if(!ingress.ingressId)continue;
     try{await this.ingress!.deleteIngress(ingress.ingressId);}
     catch(error){cleanupError??=error;}
    }
   }catch(error){cleanupError??=error;}
   try{await this.rooms!.deleteRoom(roomName);}
   catch(error){cleanupError??=error;}
   if(cleanupError)throw cleanupError;
 }
}

export const cameraMediaGateway:CameraMediaGateway=new LiveKitCloudGateway();
