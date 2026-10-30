import React,{useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {LiveKitRoom,VideoTrack,isTrackReference,registerGlobals,useTracks} from '@livekit/react-native';
import {Track} from 'livekit-client';

type Props={serverUrl:string;token:string;palette:{surface:string;foreground:string;mutedForeground:string};waitingText:string;unsupportedText:string};

function LiveVideo({palette,waitingText}:{palette:Props['palette'];waitingText:string}){
 const tracks=useTracks([Track.Source.Camera]);
 const track=tracks.find(isTrackReference);
 if(!track)return <View style={[styles.wait,{backgroundColor:'#101d25'}]}><Text style={{color:'#dbe4e6'}}>{waitingText}</Text></View>;
 return <VideoTrack trackRef={track} style={styles.video}/>;
}

export default function CameraLiveNative({serverUrl,token,palette,waitingText,unsupportedText}:Props){
 const [ready,setReady]=useState(false);
 const [unsupported,setUnsupported]=useState(false);
 useEffect(()=>{
  try{registerGlobals();setReady(true)}
  catch{setUnsupported(true)}
 },[]);
 if(unsupported)return <View style={[styles.card,{backgroundColor:palette.surface}]}><Text style={{color:palette.foreground}}>{unsupportedText}</Text></View>;
 if(!ready)return <View style={[styles.card,{backgroundColor:palette.surface}]}><Text style={{color:palette.mutedForeground}}>Preparing secure video…</Text></View>;
 return <View style={styles.frame}>
  <LiveKitRoom serverUrl={serverUrl} token={token} connect={true} audio={false} video={false}>
   <LiveVideo palette={palette} waitingText={waitingText}/>
  </LiveKitRoom>
 </View>;
}

const styles=StyleSheet.create({
 frame:{width:'100%',aspectRatio:16/9,overflow:'hidden',borderRadius:14,backgroundColor:'#101d25'},
 video:{width:'100%',height:'100%'},
 wait:{flex:1,alignItems:'center',justifyContent:'center',padding:18},
 card:{padding:15,borderRadius:14,minHeight:90,alignItems:'center',justifyContent:'center'},
});
