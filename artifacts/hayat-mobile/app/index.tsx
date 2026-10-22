import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "../components/KeyboardAwareScrollViewCompat";
import {
  createIdempotencyKey,
  getQueue,
  getSession,
  login,
  logout,
  selectContext,
  transitionDefect,
  type HayatQueueRow,
  type MobileAuthContext,
  type MobileAuthSession,
} from "../api";
import colors from "../constants/colors";

const SESSION_KEY = ["hayat-session"] as const;
const QUEUE_KEY = ["hayat-queue"] as const;
type QueueFilter = "all" | "assigned" | "in_progress" | "review";

function readableError(error: unknown) {
  if (!error || typeof error !== "object") return "Something went wrong. Try again.";
  const issue = error as { message?: string; code?: string; status?: number };
  const message = issue.message || issue.code || "Something went wrong. Try again.";
  const lower = message.toLowerCase();
  if (lower.includes("stale_version") || lower.includes("stale version")) {
    return "This defect changed on the server. Refresh the queue and review the latest status before trying again.";
  }
  if (lower.includes("forbidden") || lower.includes("permission")) {
    return "This action is not permitted for your contractor account. Your assigned work has not been changed.";
  }
  return message;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contextTitle(context: MobileAuthContext) {
  return context.building_name || context.organization_name;
}

function BrandMark() {
  return (
    <Image
      source={require("../assets/hayat-original.png")}
      contentFit="contain"
      accessibilityLabel="HAYAT by Vernatun"
      style={styles.logo}
    />
  );
}

function Eyebrow({ children }: { children: string }) {
  return <Text style={styles.eyebrow}>{children.toUpperCase()}</Text>;
}

function ErrorNotice({ message, onRetry, testID }: { message: string; onRetry?: () => void; testID?: string }) {
  return (
    <View style={styles.errorNotice} accessibilityRole="alert" testID={testID}>
      <Feather name="alert-circle" size={18} color={colors.danger} />
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" testID="error-retry">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.loadingPanel} accessibilityRole="progressbar" accessibilityLabel={label} testID="loading-state">
      <View style={styles.loadingLineLong} />
      <View style={styles.loadingLineShort} />
      <View style={styles.loadingCard} />
      <View style={styles.loadingCard} />
    </View>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: MobileAuthSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [formError, setFormError] = useState("");
  const queryClient = useQueryClient();
  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_KEY, session);
      setFormError("");
      onAuthenticated(session);
    },
    onError: (error) => {
      const message = readableError(error);
      setFormError(message);
      if (message.toLowerCase().includes("mfa") || message.toLowerCase().includes("code")) {
        setShowCode(true);
      }
    },
  });

  const submit = () => {
    setFormError("");
    if (!email.trim() || !password) {
      setFormError("Enter your work email and password to continue.");
      return;
    }
    loginMutation.mutate({ email: email.trim(), password, ...(code.trim() ? { code: code.trim() } : {}) });
  };

  return (
      <KeyboardAwareScrollViewCompat style={styles.flex} contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.authTop}>
          <BrandMark />
          <View style={styles.authRule} />
          <Eyebrow>Contractor workspace</Eyebrow>
          <Text style={styles.authTitle}>Your work.{`\n`}Right where you need it.</Text>
          <Text style={styles.authDescription}>
            Sign in to view repairs assigned to your contractor account.
          </Text>
        </View>
        <View style={styles.formPanel}>
          <Text style={styles.formHeading}>Sign in</Text>
          <Text style={styles.formSubheading}>Use your HAYAT work account.</Text>
          {formError ? <ErrorNotice message={formError} testID="login-error" /> : null}
          <Text style={styles.inputLabel}>Work email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="name@company.com"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            style={styles.input}
            testID="login-email"
            accessibilityLabel="Work email"
          />
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType={showCode ? "next" : "done"}
            onSubmitEditing={() => (showCode ? undefined : submit())}
            style={styles.input}
            testID="login-password"
            accessibilityLabel="Password"
          />
          {showCode ? (
            <>
              <Text style={styles.inputLabel}>Verification code</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="Enter your MFA code"
            placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                style={styles.input}
                testID="login-mfa"
                accessibilityLabel="Optional verification code"
              />
            </>
          ) : (
            <Pressable
              onPress={() => setShowCode(true)}
              accessibilityRole="button"
              testID="show-mfa"
              style={styles.mfaToggle}
            >
              <Feather name="shield" size={15} color={colors.mutedForeground} />
              <Text style={styles.mfaToggleText}>Have a verification code?</Text>
            </Pressable>
          )}
          <Pressable
            onPress={submit}
            disabled={loginMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            testID="login-submit"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, loginMutation.isPending && styles.disabled]}
          >
            {loginMutation.isPending ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Sign in</Text>
                <Feather name="arrow-up-right" size={18} color={colors.foreground} />
              </>
            )}
          </Pressable>
          <View style={styles.secureNote}>
            <Feather name="lock" size={13} color={colors.success} />
            <Text style={styles.secureNoteText}>Your assigned work is scoped to your secure account.</Text>
          </View>
        </View>
        <Text style={styles.footer}>HAYAT BY VERNATUN  ·  REPAIR WORKSPACE</Text>
      </KeyboardAwareScrollViewCompat>
  );
}

function ContextPicker({
  contexts,
  onSelected,
}: {
  contexts: MobileAuthContext[];
  onSelected: (session: MobileAuthSession) => void;
}) {
  const [selectionError, setSelectionError] = useState("");
  const queryClient = useQueryClient();
  const contextMutation = useMutation({
    mutationFn: selectContext,
    onSuccess: async () => {
      try {
        const session = await queryClient.fetchQuery({ queryKey: SESSION_KEY, queryFn: getSession, staleTime: 0 });
        queryClient.setQueryData(SESSION_KEY, session);
        setSelectionError("");
        onSelected(session);
      } catch (error) {
        setSelectionError(readableError(error));
      }
    },
    onError: (error) => setSelectionError(readableError(error)),
  });

  return (
    <ScrollView contentContainerStyle={styles.contextScroll}>
      <BrandMark />
      <View style={styles.contextIntro}>
        <Eyebrow>Choose your work site</Eyebrow>
        <Text style={styles.contextTitle}>Where are you{`\n`}working today?</Text>
        <Text style={styles.contextDescription}>
          Select a contractor context provided for your account. Only assigned work for this context will appear.
        </Text>
      </View>
      {selectionError ? <ErrorNotice message={selectionError} testID="context-error" /> : null}
      <View style={styles.contextList}>
        {contexts.map((context, index) => (
          <Pressable
            key={context.id}
            onPress={() => contextMutation.mutate(context.id)}
            disabled={contextMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${contextTitle(context)}`}
            testID={`context-option-${index}`}
            style={({ pressed }) => [styles.contextCard, pressed && styles.contextCardPressed, contextMutation.isPending && styles.disabled]}
          >
            <View style={styles.contextGlyph}>
              <Feather name="map-pin" size={19} color={colors.primaryPressed} />
            </View>
            <View style={styles.contextCopy}>
              <Text style={styles.contextName}>{contextTitle(context)}</Text>
              {context.building_name && context.organization_name ? (
                <Text style={styles.contextOrg}>{context.organization_name}</Text>
              ) : null}
              <Text style={styles.contextRole}>{statusLabel(context.role_key)}</Text>
            </View>
            {contextMutation.isPending ? (
              <ActivityIndicator color={colors.primaryPressed} />
            ) : (
              <Feather name="arrow-up-right" size={18} color={colors.mutedForeground} />
            )}
          </Pressable>
        ))}
      </View>
      {!contexts.length ? (
        <View style={styles.emptyPanel}>
          <Feather name="map" size={25} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No contractor sites available</Text>
          <Text style={styles.emptyBody}>Ask your administrator to grant an active contractor context.</Text>
        </View>
      ) : null}
      <Text style={styles.footer}>HAYAT BY VERNATUN  ·  SECURE WORKSPACE</Text>
    </ScrollView>
  );
}

function QueueScreen({
  session,
  onLogout,
}: {
  session: MobileAuthSession & { user: NonNullable<MobileAuthSession["user"]> };
  onLogout: () => void;
}) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState("");
  const [actionError, setActionError] = useState("");
  const queryClient = useQueryClient();
  const activeContext = session.contexts.find((context) => context.id === session.contextId);
  const serverStatus = filter === "all" ? undefined : filter;
  const queueQuery = useInfiniteQuery({
    queryKey: [...QUEUE_KEY, serverStatus ?? "all"],
    queryFn: ({ pageParam }) => getQueue(serverStatus, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loadedCount = pages.reduce((count, page) => count + page.rows.length, 0);
      return loadedCount < lastPage.total ? pages.length : undefined;
    },
    enabled: !!session.contextId,
    retry: 1,
  });
  const transitionMutation = useMutation({
    mutationFn: ({ row, action, note }: { row: HayatQueueRow; action: "start" | "report"; note?: string }) =>
      transitionDefect(row.id, {
        key: createIdempotencyKey(),
        action,
        version: row.version,
        ...(note ? { note } : {}),
      }),
    onSuccess: async () => {
      setActionError("");
      setReportNote("");
      await queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      await queryClient.refetchQueries({ queryKey: QUEUE_KEY, type: "active" });
    },
    onError: (error) => setActionError(readableError(error)),
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      onLogout();
    },
    onError: (error) => setActionError(readableError(error)),
  });
  const pages = queueQuery.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.rows);
  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);
  const filterOptions: { key: QueueFilter; label: string }[] = [
    { key: "all", label: "All work" },
    { key: "assigned", label: "Assigned" },
    { key: "in_progress", label: "In progress" },
    { key: "review", label: "In review" },
  ];

  const startRepair = (row: HayatQueueRow) => {
    setActionError("");
    transitionMutation.mutate({ row, action: "start" });
  };
  const submitReport = (row: HayatQueueRow) => {
    if (reportNote.trim().length < 5) {
      setActionError("Add a short completion note (at least 5 characters) before sending for review.");
      return;
    }
    setActionError("");
    transitionMutation.mutate({ row, action: "report", note: reportNote.trim() });
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.queueScroll}
        keyboardShouldPersistTaps="handled"
        testID="queue-scroll"
      >
        <View style={styles.appHeader}>
          <BrandMark />
          <Pressable
            onPress={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            testID="logout-button"
            style={styles.logoutButton}
          >
            {logoutMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <Feather name="log-out" size={19} color={colors.foreground} />
            )}
          </Pressable>
        </View>
        <View style={styles.greetingRow}>
          <View style={styles.greetingCopy}>
            <Eyebrow>Contractor queue</Eyebrow>
            <Text style={styles.queueTitle}>Good work,{`\n`}{session.user.name.split(" ")[0]}.</Text>
            <Text style={styles.queueSubhead}>Repairs assigned to you, ready for the field.</Text>
          </View>
          <View style={styles.queueCountBadge}>
            <Text style={styles.queueCount}>{pages[0]?.total ?? "—"}</Text>
            <Text style={styles.queueCountLabel}>TOTAL</Text>
          </View>
        </View>

        {activeContext ? (
          <View style={styles.siteStrip} testID="active-context">
            <View style={styles.siteIcon}><Feather name="map-pin" size={15} color={colors.primaryPressed} /></View>
            <View style={styles.siteCopy}>
              <Text style={styles.siteName}>{contextTitle(activeContext)}</Text>
              <Text style={styles.siteMeta}>{activeContext.organization_name}  ·  {session.user.email}</Text>
            </View>
            <Feather name="check-circle" size={17} color={colors.success} />
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <View>
            <Eyebrow>Work list</Eyebrow>
            <Text style={styles.sectionTitle}>Assigned defects</Text>
          </View>
          <Pressable
            onPress={() => queueQuery.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Refresh assigned defects"
            testID="queue-refresh"
            style={styles.refreshButton}
          >
            <Feather name="refresh-cw" size={17} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRail}>
          {filterOptions.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => {
                setFilter(option.key);
                setSelectedId(null);
                setActionError("");
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === option.key }}
              testID={`filter-${option.key}`}
              style={[styles.filterChip, filter === option.key && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, filter === option.key && styles.filterTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {actionError ? (
          <ErrorNotice
            message={actionError}
            onRetry={queueQuery.refetch}
            testID="action-error"
          />
        ) : null}

        {queueQuery.isPending ? (
          <LoadingState label="Loading assigned defects" />
        ) : queueQuery.isError ? (
          <View style={styles.emptyPanel} testID="queue-error">
            <View style={styles.emptyIcon}><Feather name="wifi-off" size={22} color={colors.danger} /></View>
            <Text style={styles.emptyTitle}>Could not load your queue</Text>
            <Text style={styles.emptyBody}>{readableError(queueQuery.error)}</Text>
            <Pressable onPress={() => queueQuery.refetch()} style={styles.secondaryButton} testID="queue-retry">
              <Feather name="refresh-cw" size={16} color={colors.foreground} />
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : selectedRow ? (
          <View style={styles.detailPanel} testID="defect-detail">
            <Pressable
              onPress={() => { setSelectedId(null); setActionError(""); }}
              accessibilityRole="button"
              testID="detail-back"
              style={styles.backButton}
            >
              <Feather name="arrow-left" size={16} color={colors.foreground} />
              <Text style={styles.backText}>Back to work list</Text>
            </Pressable>
            <View style={styles.detailTopline}>
              <Text style={styles.defectNumber}>DEFECT  /  {selectedRow.id.slice(0, 8).toUpperCase()}</Text>
              <StatusPill status={selectedRow.status} />
            </View>
            <Text style={styles.detailTitle}>{selectedRow.subject}</Text>
            <Text style={styles.detailDescription}>
              {selectedRow.description || "No additional description provided."}
            </Text>
            <View style={styles.detailFacts}>
              <Fact icon="map-pin" label="LOCATION" value={[selectedRow.building_name, selectedRow.location, selectedRow.number].filter(Boolean).join(" · ") || "Location not provided"} />
              <Fact icon="calendar" label="DUE DATE" value={formatDate(selectedRow.due_on)} />
              <Fact icon="clock" label="ASSIGNED" value={formatDate(selectedRow.created_at)} />
            </View>
            {selectedRow.status === "assigned" ? (
              <View style={styles.actionBlock}>
                <Text style={styles.actionHint}>Ready to begin? Starting this repair updates its status for your team.</Text>
                <Pressable
                  onPress={() => startRepair(selectedRow)}
                  disabled={transitionMutation.isPending}
                  accessibilityRole="button"
                  testID="start-repair"
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, transitionMutation.isPending && styles.disabled]}
                >
                  {transitionMutation.isPending ? <ActivityIndicator color={colors.foreground} /> : (
                    <>
                      <Feather name="tool" size={17} color={colors.foreground} />
                      <Text style={styles.primaryButtonText}>Start repair</Text>
                      <Feather name="arrow-right" size={17} color={colors.foreground} />
                    </>
                  )}
                </Pressable>
              </View>
            ) : selectedRow.status === "in_progress" ? (
              <View style={styles.actionBlock}>
                <Text style={styles.actionHeading}>Repair complete?</Text>
                <Text style={styles.actionHint}>Send a short completion report. The work will move to review.</Text>
                <TextInput
                  value={reportNote}
                  onChangeText={(text) => { setReportNote(text); setActionError(""); }}
                  placeholder="What was repaired? Include useful details."
            placeholderTextColor={colors.mutedForeground}
                  multiline
                  maxLength={4000}
                  textAlignVertical="top"
                  style={[styles.input, styles.reportInput]}
                  accessibilityLabel="Completion report"
                  testID="completion-note"
                />
                <Text style={styles.characterCount}>{reportNote.length} / 4000</Text>
                <Pressable
                  onPress={() => submitReport(selectedRow)}
                  disabled={transitionMutation.isPending}
                  accessibilityRole="button"
                  testID="submit-report"
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, transitionMutation.isPending && styles.disabled]}
                >
                  {transitionMutation.isPending ? <ActivityIndicator color={colors.foreground} /> : (
                    <>
                      <Feather name="send" size={16} color={colors.foreground} />
                      <Text style={styles.primaryButtonText}>Submit for review</Text>
                      <Feather name="arrow-right" size={17} color={colors.foreground} />
                    </>
                  )}
                </Pressable>
              </View>
            ) : (
              <View style={styles.reviewNotice}>
                <Feather name="check-circle" size={19} color={colors.success} />
                <View style={styles.reviewCopy}>
                  <Text style={styles.reviewTitle}>Report submitted</Text>
                   <Text style={styles.reviewBody}>
                     {selectedRow.status === "accepted"
                       ? "This repair has been accepted."
                       : "This repair is waiting for review. You can return to your queue."}
                   </Text>
                </View>
              </View>
            )}
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.emptyPanel} testID="queue-empty">
            <View style={styles.emptyIcon}><Feather name="check" size={22} color={colors.success} /></View>
            <Text style={styles.emptyTitle}>{filter === "all" ? "You’re all caught up" : `No ${statusLabel(filter).toLowerCase()} work`}</Text>
            <Text style={styles.emptyBody}>
              {filter === "all" ? "New defects assigned to you will appear here." : "Try another status filter to see your assigned work."}
            </Text>
          </View>
        ) : (
          <View style={styles.defectList} testID="defect-list">
            {rows.map((row) => (
              <DefectCard key={row.id} row={row} onPress={() => { setSelectedId(row.id); setActionError(""); }} />
            ))}
          </View>
        )}

        <View style={styles.queueFooter}>
          <Text style={styles.footer}>HAYAT BY VERNATUN</Text>
          <Text style={styles.queueUpdated}>
            {pages[0]?.serverTime ? `Synced ${formatTime(pages[0].serverTime)}` : "Assigned work only"}
          </Text>
        </View>
        {queueQuery.hasNextPage ? (
          <Pressable
            onPress={() => queueQuery.fetchNextPage()}
            disabled={queueQuery.isFetchingNextPage}
            accessibilityRole="button"
            testID="queue-load-more"
            style={styles.secondaryButton}
          >
            {queueQuery.isFetchingNextPage
              ? <ActivityIndicator size="small" color={colors.foreground} />
              : <Feather name="plus" size={16} color={colors.foreground} />}
            <Text style={styles.secondaryButtonText}>
              {queueQuery.isFetchingNextPage ? "Loading…" : "Load more assigned work"}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "in_progress" ? styles.statusGreen : status === "review" ? styles.statusAmber : styles.statusNeutral;
  return (
    <View style={[styles.statusPill, tone]}>
      <View style={styles.statusDot} />
      <Text style={styles.statusText}>{statusLabel(status)}</Text>
    </View>
  );
}

function DefectCard({ row, onPress }: { row: HayatQueueRow; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.subject}, ${statusLabel(row.status)}, due ${formatDate(row.due_on)}`}
      testID={`defect-${row.id}`}
      style={({ pressed }) => [styles.defectCard, pressed && styles.defectCardPressed]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.defectNumber}>DEFECT  /  {row.id.slice(0, 8).toUpperCase()}</Text>
        <StatusPill status={row.status} />
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{row.subject}</Text>
      <View style={styles.cardLocation}>
        <Feather name="map-pin" size={14} color={colors.mutedForeground} />
        <Text style={styles.cardLocationText} numberOfLines={1}>
          {[row.building_name, row.location, row.number].filter(Boolean).join(" · ") || "Location not provided"}
        </Text>
      </View>
      <View style={styles.cardBottom}>
        <View>
          <Text style={styles.metaLabel}>DUE</Text>
          <Text style={styles.metaValue}>{formatDate(row.due_on)}</Text>
        </View>
        <View style={styles.cardAction}>
          <Text style={styles.openText}>Open defect</Text>
          <Feather name="arrow-up-right" size={16} color={colors.primaryPressed} />
        </View>
      </View>
    </Pressable>
  );
}

function Fact({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <View style={styles.factIcon}><Feather name={icon} size={16} color={colors.mutedForeground} /></View>
      <View style={styles.factCopy}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    </View>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function Index() {
  const insets = useSafeAreaInsets();
  const sessionQuery = useQuery({
    queryKey: SESSION_KEY,
    queryFn: getSession,
    retry: false,
    staleTime: 0,
  });
  const [localSession, setLocalSession] = useState<MobileAuthSession | null>(null);
  const session = localSession ?? sessionQuery.data ?? null;
  const queueSession = session?.user
    ? { ...session, user: session.user }
    : null;
  const contractorContexts = useMemo(
    () => (session?.contexts ?? []).filter(
      (context) => context.role_key === "contractor" && context.permissions.includes("defects.assigned"),
    ),
    [session?.contexts],
  );
  const activeContractorContext = contractorContexts.find((context) => context.id === session?.contextId);
  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;
  const screenStyle = {
    paddingTop: Math.max(insets.top, webTop),
    paddingBottom: Math.max(insets.bottom, webBottom),
  };

  const onAuthenticated = (nextSession: MobileAuthSession) => {
    setLocalSession(nextSession);
  };
  const onLogout = () => {
    setLocalSession(null);
  };

  return (
    <View style={[styles.screen, screenStyle]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      {sessionQuery.isPending && !session ? (
        <View style={[styles.flex, styles.bootLoading]}>
          <BrandMark />
          <LoadingState label="Checking secure session" />
        </View>
      ) : sessionQuery.isError && !localSession ? (
        <View style={[styles.flex, styles.bootLoading]}>
          <BrandMark />
          <View style={styles.emptyPanel}>
            <View style={styles.emptyIcon}><Feather name="wifi-off" size={22} color={colors.danger} /></View>
            <Text style={styles.emptyTitle}>Could not check your secure session</Text>
            <Text style={styles.emptyBody}>{readableError(sessionQuery.error)}</Text>
            <Pressable onPress={() => sessionQuery.refetch()} style={styles.secondaryButton} testID="session-retry">
              <Feather name="refresh-cw" size={16} color={colors.foreground} />
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      ) : session ? (
        activeContractorContext && queueSession ? (
          <QueueScreen session={queueSession} onLogout={onLogout} />
        ) : (
          <ContextPicker contexts={contractorContexts} onSelected={onAuthenticated} />
        )
      ) : (
        <LoginScreen onAuthenticated={onAuthenticated} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  bootLoading: { paddingHorizontal: 24, paddingTop: 28 },
  logo: { width: 188, height: 70 },
  authScroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 22 },
  authTop: { paddingTop: 8 },
  authRule: { width: 42, height: 3, backgroundColor: colors.primary, marginTop: 23, marginBottom: 23 },
  eyebrow: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 1.35, fontWeight: "700" },
  authTitle: { fontSize: 35, lineHeight: 39, letterSpacing: -1.4, fontWeight: "800", color: colors.foreground, marginTop: 10 },
  authDescription: { fontSize: 14, lineHeight: 21, color: colors.mutedForeground, marginTop: 12, maxWidth: 310 },
  formPanel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 19, marginTop: 25 },
  formHeading: { fontSize: 20, letterSpacing: -0.5, fontWeight: "700", color: colors.foreground },
  formSubheading: { fontSize: 12, color: colors.mutedForeground, marginTop: 4, marginBottom: 17 },
  inputLabel: { fontSize: 11, fontWeight: "700", color: colors.foreground, marginBottom: 7, marginTop: 13 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, color: colors.foreground, backgroundColor: colors.surface, },
  mfaToggle: { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", paddingVertical: 11, marginTop: 2 },
  mfaToggleText: { fontSize: 12, color: colors.mutedForeground, fontWeight: "600" },
  primaryButton: { minHeight: 51, borderRadius: 9, backgroundColor: colors.primary, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, marginTop: 18 },
  primaryButtonText: { color: colors.foreground, fontWeight: "700", fontSize: 14, flex: 1, textAlign: "center" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.58 },
  secureNote: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 15 },
  secureNoteText: { color: colors.mutedForeground, fontSize: 10, flex: 1 },
  footer: { fontSize: 9, letterSpacing: 1.1, fontWeight: "700", color: colors.mutedForeground },
  contextScroll: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 17, paddingBottom: 24 },
  contextIntro: { marginTop: 32, marginBottom: 22 },
  contextTitle: { color: colors.foreground, fontSize: 33, lineHeight: 38, letterSpacing: -1.2, fontWeight: "800", marginTop: 10 },
  contextDescription: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 11, maxWidth: 325 },
  contextList: { gap: 11 },
  contextCard: { flexDirection: "row", alignItems: "center", gap: 13, padding: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 13, minHeight: 84 },
  contextCardPressed: { backgroundColor: colors.surfaceMuted },
  contextGlyph: { width: 41, height: 41, borderRadius: 11, backgroundColor: colors.primarySurface, alignItems: "center", justifyContent: "center" },
  contextCopy: { flex: 1, gap: 3 },
  contextName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  contextOrg: { fontSize: 11, color: colors.mutedForeground },
  contextRole: { fontSize: 10, color: colors.primaryPressed, fontWeight: "700", marginTop: 2 },
  errorNotice: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.dangerBackground, borderRadius: 9, padding: 11, marginTop: 11 },
  errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 17 },
  retryText: { fontSize: 12, fontWeight: "700", color: colors.danger, padding: 4 },
  emptyPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, padding: 24, alignItems: "center", marginTop: 16 },
  emptyIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.successBackground, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.foreground, textAlign: "center" },
  emptyBody: { fontSize: 12, lineHeight: 18, color: colors.mutedForeground, textAlign: "center", marginTop: 7, maxWidth: 280 },
  appHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 59 },
  logoutButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  queueScroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 22 },
  greetingRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 22, marginBottom: 18 },
  greetingCopy: { flex: 1, paddingRight: 8 },
  queueTitle: { fontSize: 32, lineHeight: 35, letterSpacing: -1.3, color: colors.foreground, fontWeight: "800", marginTop: 7 },
  queueSubhead: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, marginTop: 8, maxWidth: 255 },
  queueCountBadge: { width: 58, height: 65, borderRadius: 14, backgroundColor: colors.foreground, alignItems: "center", justifyContent: "center", marginBottom: 1 },
  queueCount: { color: colors.surface, fontSize: 22, lineHeight: 25, fontWeight: "800" },
  queueCountLabel: { color: colors.mutedOnDark, fontSize: 8, letterSpacing: 1.1, fontWeight: "700", marginTop: 3 },
  siteStrip: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 11, backgroundColor: colors.surfaceMuted, marginBottom: 27 },
  siteIcon: { width: 33, height: 33, borderRadius: 10, backgroundColor: colors.primarySurface, alignItems: "center", justifyContent: "center" },
  siteCopy: { flex: 1 },
  siteName: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
  siteMeta: { color: colors.mutedForeground, fontSize: 9, marginTop: 3 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 13 },
  sectionTitle: { fontSize: 21, color: colors.foreground, letterSpacing: -0.5, fontWeight: "800", marginTop: 4 },
  refreshButton: { width: 39, height: 39, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  filterRail: { gap: 7, paddingBottom: 15 },
  filterChip: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center" },
  filterChipActive: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  filterText: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600" },
  filterTextActive: { color: colors.surface, fontWeight: "700" },
  defectList: { gap: 11 },
  defectCard: { backgroundColor: colors.surface, borderRadius: 13, borderWidth: 1, borderColor: colors.border, padding: 15 },
  defectCardPressed: { backgroundColor: colors.surfacePressed, transform: [{ scale: 0.995 }] },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  defectNumber: { color: colors.mutedForeground, fontSize: 9, letterSpacing: 0.9, fontWeight: "700" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { width: 5, height: 5, borderRadius: 4, backgroundColor: colors.foreground },
  statusNeutral: { backgroundColor: colors.neutralStatus },
  statusGreen: { backgroundColor: colors.successBackground },
  statusAmber: { backgroundColor: colors.warningBackground },
  statusText: { color: colors.foreground, fontSize: 9, fontWeight: "700" },
  cardTitle: { color: colors.foreground, fontSize: 17, lineHeight: 21, letterSpacing: -0.35, fontWeight: "700", marginTop: 12 },
  cardLocation: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 9 },
  cardLocationText: { color: colors.mutedForeground, fontSize: 11, flex: 1 },
  cardBottom: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 14, paddingTop: 11 },
  metaLabel: { fontSize: 8, color: colors.mutedForeground, letterSpacing: 0.8, fontWeight: "700" },
  metaValue: { fontSize: 11, color: colors.foreground, fontWeight: "600", marginTop: 4 },
  cardAction: { flexDirection: "row", alignItems: "center", gap: 5, padding: 3 },
  openText: { color: colors.primaryPressed, fontSize: 11, fontWeight: "700" },
  loadingPanel: { gap: 11, paddingVertical: 7 },
  loadingLineLong: { height: 12, width: "56%", backgroundColor: colors.loading, borderRadius: 5, marginBottom: 7 },
  loadingLineShort: { height: 8, width: "34%", backgroundColor: colors.loading, borderRadius: 5, marginBottom: 6 },
  loadingCard: { height: 131, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.loadingCard },
  detailPanel: { backgroundColor: colors.surface, borderRadius: 15, borderWidth: 1, borderColor: colors.border, padding: 17 },
  backButton: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 7, paddingVertical: 4, paddingRight: 8 },
  backText: { color: colors.foreground, fontSize: 11, fontWeight: "700" },
  detailTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 18 },
  detailTitle: { color: colors.foreground, fontSize: 25, lineHeight: 29, letterSpacing: -0.7, fontWeight: "800", marginTop: 13 },
  detailDescription: { color: colors.mutedForeground, fontSize: 13, lineHeight: 20, marginTop: 10 },
  detailFacts: { gap: 13, borderTopWidth: 1, borderTopColor: colors.divider, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: 15, marginTop: 18 },
  factRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  factIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  factCopy: { flex: 1 },
  factValue: { color: colors.foreground, fontSize: 12, lineHeight: 17, fontWeight: "600", marginTop: 3 },
  actionBlock: { marginTop: 17 },
  actionHeading: { color: colors.foreground, fontSize: 17, fontWeight: "800" },
  actionHint: { color: colors.mutedForeground, fontSize: 11, lineHeight: 17, marginTop: 2 },
  reportInput: { minHeight: 94, marginTop: 12, paddingTop: 12 },
  characterCount: { color: colors.mutedForeground, fontSize: 9, textAlign: "right", marginTop: 5 },
  reviewNotice: { flexDirection: "row", gap: 11, alignItems: "flex-start", borderRadius: 10, backgroundColor: colors.successBackground, padding: 13, marginTop: 17 },
  reviewCopy: { flex: 1 },
  reviewTitle: { color: colors.success, fontSize: 13, fontWeight: "700" },
  reviewBody: { color: colors.success, fontSize: 11, lineHeight: 16, marginTop: 3 },
  secondaryButton: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 42, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 9, paddingHorizontal: 14, marginTop: 15 },
  secondaryButtonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
  queueFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, paddingTop: 12 },
  queueUpdated: { color: colors.mutedForeground, fontSize: 10 },
});
