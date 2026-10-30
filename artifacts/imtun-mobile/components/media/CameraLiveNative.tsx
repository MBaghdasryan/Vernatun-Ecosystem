import React,{useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {LiveKitRoom,VideoTrack,isTrackReference,registerGlobals,useTracks} from '@livekit/react-native';
import {Track} from 'livekit-client';

type Props={serverUrl:string;token:string;palette:{surface:string;foreground:string;mutedForeground:string}};

function LiveVideo({palette}:{palette:Props['palette']}){
 const tracks=useTracks([Track.Source.Camera]);
 const track=tracks.find(isTrackReference);
 if(!track)return <View style={[styles.wait,{backgroundColor:'#101d25'}]}><Text style={{color:'#dbe4e6'}}>Waiting for Edge video…</Text></View>;
 return <VideoTrack trackRef={track} style={styles.video}/>;
}

export default function CameraLiveNative({serverUrl,token,palette}:Props){
 const [ready,setReady]=useState(false);
 const [unsupported,setUnsupported]=useState(false);
 useEffect(()=>{
  try{registerGlobals();setReady(true)}
  catch{setUnsupported(true)}
 },[]);
 if(unsupported)return <View style={[styles.card,{backgroundColor:palette.surface}]}><Text style={{color:palette.foreground}}>Live video needs an ImTun development build with the native LiveKit module.</Text></View>;
 if(!ready)return <View style={[styles.card,{backgroundColor:palette.surface}]}><Text style={{color:palette.mutedForeground}}>Preparing secure video…</Text></View>;
 return <View style={styles.frame}>
  <LiveKitRoom serverUrl={serverUrl} token={token} connect={true} audio={false} video={false}>
   <LiveVideo palette={palette}/>
  </LiveKitRoom>
 </View>;
}

const styles=StyleSheet.create({
 frame:{width:'100%',aspectRatio:16/9,overflow:'hidden',borderRadius:14,backgroundColor:'#101d25'},
 video:{width:'100%',height:'100%'},
 wait:{flex:1,alignItems:'center',justifyContent:'center',padding:18},
 card:{padding:15,borderRadius:14,minHeight:90,alignItems:'center',justifyContent:'center'},
});
