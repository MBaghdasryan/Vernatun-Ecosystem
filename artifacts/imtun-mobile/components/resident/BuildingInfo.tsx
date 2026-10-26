import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ResidentWorkspace } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { L, S, integStatus, integName, type Language, type T } from '@/lib/resident/text';
import { Card, Chip } from './Ui';
export function homeRows(ws: ResidentWorkspace, l: Language): [T, string][] {
  const h = ws.home, na = L(l, S.unknown);
  const amt = (v: string | null) => v == null ? na : `${(Number(v) / 100).toLocaleString(l)} ${h.currency}`;
  return [[S.open, h.openRequests == null ? na : String(h.openRequests)], [S.unread, h.unreadNotifications == null ? na : String(h.unreadNotifications)], [S.payable, amt(h.payableMinor)], [S.overdue, amt(h.overdueMinor)], [S.paid, amt(h.annualPaidMinor)]];
}
export default function BuildingInfo({ ws, l }: { ws: ResidentWorkspace; l: Language }) { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const w = ws.building, na = L(l, S.unknown);
  return <View style={{ gap: 12 }}>
    <Card><Text style={st.h}>{w.name}</Text><Text style={st.m}>{w.address}</Text><Text style={st.m}>{w.organization}{w.unit ? ' · ' + w.unit : ''}{w.area ? ' · ' + w.area + ' m²' : ''}</Text></Card>
    <View style={st.grid}>{homeRows(ws, l).map(([k, v], i) => <View key={i} style={st.stat}><Text style={st.m}>{L(l, k)}</Text><Text style={st.v}>{v}</Text></View>)}</View>
    {ws.integrations.length > 0 && <Card>{ws.integrations.map(i => <View key={i.key} style={{ gap: 4 }}><Text style={st.m}>{integName[i.key] ? L(l, integName[i.key]) : i.key.replace(/[-_]/g, ' ')}</Text><Chip tone={i.status === 'ACTIVE' ? 'ok' : 'warn'} label={integStatus[i.status] ? L(l, integStatus[i.status]) : na} /></View>)}{ws.integrations.some(i => i.status !== 'ACTIVE') && <Text style={st.m}>{L(l, S.blocked)}</Text>}</Card>}
  </View>;
}
const make_st = (palette: Palette) => StyleSheet.create({ h: { fontSize: 20, fontWeight: '800', color: palette.foreground }, m: { color: palette.mutedForeground, fontSize: 12 }, v: { fontSize: 20, fontWeight: '800', color: palette.foreground }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, stat: { flexGrow: 1, minWidth: '45%', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 13, padding: 14, gap: 4 } });
