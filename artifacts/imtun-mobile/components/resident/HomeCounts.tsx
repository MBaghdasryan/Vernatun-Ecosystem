import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette } from '@/constants/colors';
import { L, S } from '@/lib/resident/text';
import { useLang, useWorkspace } from '@/lib/resident/hooks';
import { homeRows } from './BuildingInfo';
// Server-computed Home counts; null is shown as "not available", never as zero.
export default function HomeCounts() {
  const ws = useWorkspace(); const l = useLang();
  if (ws.isPending) return <View style={st.skel} />;
  if (ws.isError || !ws.data) return <Text style={st.m} onPress={() => ws.refetch()}>{L(l, S.fail)} {L(l, S.retry)}</Text>;
  return <View style={st.grid}>{homeRows(ws.data, l).map(([k, v], i) => <View key={i} style={st.stat}><Text style={st.m}>{L(l, k)}</Text><Text style={st.v}>{v}</Text></View>)}</View>;
}
const st = StyleSheet.create({ skel: { height: 80, borderRadius: 14, backgroundColor: palette.skeleton }, m: { color: palette.mutedForeground, fontSize: 12 }, v: { fontSize: 18, fontWeight: '800', color: palette.foreground }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, stat: { flexGrow: 1, minWidth: '30%', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 13, padding: 12, gap: 3 } });
