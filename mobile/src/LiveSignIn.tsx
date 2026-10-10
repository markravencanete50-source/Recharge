import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Platform, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from "react-native-svg";
import * as Linking from "expo-linking";
import { Text } from "./Typography";
import { CompanyLogo } from "./CompanyLogo";
import { HomeScene } from "./HomeScene";
import { HeroGlow } from "./TodayAnalytics";
import { MotionPress, Stagger, motionTokens, useReducedMotion } from "./motion";
import { headerPalette, ui, type Palette } from "./theme";
import { accountStep, liveApiOrigin, registrationOpen, signIn } from "./backend/client";
import { LegalConsent } from "./LivePrivacy";
import { darkBrandCanvas, designTokens } from "../../lib/design-tokens";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { readableError } from "../../lib/error-copy";

const message = (error: unknown) => readableError(error);

type Kind = "email" | "password" | "new-password" | "name" | "code";
const KIND: Record<Kind, { icon: "mail" | "lock" | "user" | "hash"; placeholder: string; autoComplete: "email" | "current-password" | "new-password" | "name" | "one-time-code" }> = {
  email: { icon: "mail", placeholder: "you@example.com", autoComplete: "email" },
  password: { icon: "lock", placeholder: "Your password", autoComplete: "current-password" },
  "new-password": { icon: "lock", placeholder: "At least 12 characters", autoComplete: "new-password" },
  name: { icon: "user", placeholder: "First and last name", autoComplete: "name" },
  code: { icon: "hash", placeholder: "6-digit code", autoComplete: "one-time-code" },
};
function Input({ label, value, onChange, p, kind, onSubmit }: { label: string; value: string; onChange: (value: string) => void; p: Palette; kind: Kind; onSubmit?: () => void }) {
  const secure = kind === "password" || kind === "new-password", email = kind === "email", k = KIND[kind];
  const [hidden, setHidden] = useState(true), [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      <View style={[ui.row, { minHeight: 52, borderRadius: 16, borderWidth: focused ? 1.5 : 1, borderColor: focused ? p.primary : p.controlBorder, backgroundColor: p.background, paddingLeft: 14, gap: 10 },
        Platform.OS === "web" ? ({ transitionProperty: "border-color, box-shadow", transitionDuration: "200ms", boxShadow: focused ? `0 0 0 4px ${p.primary}26` : "none" } as object) : null]}>
        <Feather name={k.icon} size={17} color={focused ? p.primary : p.muted} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          returnKeyType={secure ? "go" : "next"}
          autoCapitalize={kind === "name" ? "words" : "none"}
          autoCorrect={false}
          autoComplete={k.autoComplete}
          keyboardType={email ? "email-address" : kind === "code" ? "number-pad" : "default"}
          secureTextEntry={secure && hidden}
          placeholder={k.placeholder}
          placeholderTextColor={p.muted}
          style={[{ flex: 1, minHeight: 50, color: p.text, fontSize: 15, fontFamily: "Montserrat_500Medium", backgroundColor: "transparent" }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
        />
        {secure && (
          <MotionPress accessibilityRole="button" accessibilityLabel={hidden ? "Show password" : "Hide password"} onPress={() => setHidden(!hidden)} style={{ width: 48, height: 50, alignItems: "center", justifyContent: "center" }}>
            <Feather name={hidden ? "eye" : "eye-off"} size={18} color={p.muted} />
          </MotionPress>
        )}
      </View>
    </View>
  );
}

function Problem({ p, text }: { p: Palette; text: string }) {
  return (
    <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}>
      <Feather name="alert-circle" size={16} color={p.waiting} />
      <Text style={[ui.small, { color: p.text, flex: 1 }]}>{text}</Text>
    </View>
  );
}
function Primary({ p, label, busy, disabled, onPress }: { p: Palette; label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    // Stays in the brand colour while it can't be pressed yet (no washed-out grey); only the
    // arrow fades until the details are filled in.
    <MotionPress accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.between, { minHeight: 54, paddingHorizontal: 20, borderRadius: 18, backgroundColor: p.primary, opacity: disabled && !busy ? 0.9 : 1 },
      Platform.OS === "web" ? ({ transitionProperty: "opacity, box-shadow", transitionDuration: "200ms", boxShadow: disabled ? "none" : `0 14px 28px -16px ${p.primary}` } as object) : null]}>
      <Text style={{ color: p.onPrimary, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      {busy ? <ActivityIndicator color={p.onPrimary} /> : <Feather name="arrow-right" size={18} color={p.onPrimary} style={{ opacity: disabled ? 0.45 : 1 }} />}
    </MotionPress>
  );
}
function TextLink({ p, label, onPress }: { p: Palette; label: string; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="link" onPress={onPress} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
      <Text style={{ color: p.primary, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </MotionPress>
  );
}

// Self sign-up: details, then the code from the verification email. The new account waits for an
// administrator to approve it and give it a role, as in People → Approve access.
function CreateAccount({ p, desktop, onBack }: { p: Palette; desktop: boolean; onBack: (email: string) => void }) {
  const [step, setStep] = useState<"details" | "code" | "done">("details");
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [again, setAgain] = useState(""), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const address = email.trim().toLowerCase();
  const short = password.length > 0 && password.length < 12, mismatch = again.length > 0 && again !== password;
  const ready = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && password.length >= 12 && password.length <= 72 && password === again;
  async function register() {
    if (busy || !ready) return;
    setBusy(true); setError("");
    try { await accountStep({ action: "register", method: "email", address, password }); setStep("code"); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function verify() {
    if (busy || !/^\d{6,8}$/.test(code.trim())) return;
    setBusy(true); setError("");
    try {
      const result = await accountStep({ action: "verify", method: "email", address, code: code.trim() });
      // The verified code gives a short-lived token used only to save the person's name.
      if (typeof result.accessToken === "string") await accountStep({ displayName: name.trim().slice(0, 60), avatar: "forest" }, result.accessToken).catch(() => undefined);
      setPassword(""); setAgain(""); setCode(""); setStep("done");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const title = (text: string, sub: string) => (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: desktop ? 34 : 28, lineHeight: desktop ? 40 : 34 }]}>{text}</Text>
      <Text style={[ui.body, { color: p.muted }]}>{sub}</Text>
    </View>
  );
  if (step === "done") return (
    <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 18 }}>
      {title("Account created", "Thanks, " + (name.trim().split(/\s+/)[0] || "there") + ". An administrator will now give you access to the right tools. You can sign in once they have.")}
      <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, backgroundColor: p.wash, alignItems: "flex-start" }]}>
        <Feather name="clock" size={16} color={p.primary} style={{ marginTop: 2 }} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>Until then, signing in shows that your account is waiting for approval.</Text>
      </View>
      <Primary p={p} label="Back to sign in" busy={false} disabled={false} onPress={() => onBack(address)} />
    </View>
  );
  return (
    <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 18 }}>
      {step === "details" ? <>
        {title("Create an account", "Your administrator approves new accounts and chooses what you can see.")}
        <Input label="Full name" value={name} onChange={setName} p={p} kind="name" />
        <Input label="Email" value={email} onChange={setEmail} p={p} kind="email" />
        <Input label="Password" value={password} onChange={setPassword} p={p} kind="new-password" />
        <Input label="Confirm password" value={again} onChange={setAgain} p={p} kind="new-password" onSubmit={() => void register()} />
        {(short || mismatch) && <Text style={[ui.small, { color: p.waiting }]}>{short ? "Use at least 12 characters." : "The passwords don’t match."}</Text>}
        {!!error && <Problem p={p} text={error} />}
        <Primary p={p} label={busy ? "Creating…" : "Create account"} busy={busy} disabled={busy || !ready} onPress={() => void register()} />
        <LegalConsent p={p} />
      </> : <>
        {title("Check your email", `We sent a code to ${address}. Enter it here to confirm your email. It can take a minute to arrive; check spam too.`)}
        <Input label="Code" value={code} onChange={v => setCode(v.replace(/\D/g, "").slice(0, 8))} p={p} kind="code" onSubmit={() => void verify()} />
        {!!error && <Problem p={p} text={error} />}
        <Primary p={p} label={busy ? "Checking…" : "Confirm email"} busy={busy} disabled={busy || !/^\d{6,8}$/.test(code)} onPress={() => void verify()} />
        <TextLink p={p} label="Use a different email" onPress={() => { setStep("details"); setError(""); setCode(""); }} />
      </>}
      <TextLink p={p} label="I already have an account" onPress={() => onBack(address)} />
    </View>
  );
}

// The live sign-in, in the same forest-and-bone design as the workspace.
export function LiveSignIn({ palette: p, onSignedIn, onTheme, notice = "" }: { palette: Palette; onSignedIn: (account: WorkspaceAccount) => void; onTheme: () => void; notice?: string }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [canRegister, setCanRegister] = useState(false);
  const header = headerPalette(p);
  useEffect(() => { let alive = true; void registrationOpen().then(open => { if (alive) setCanRegister(open); }); return () => { alive = false; }; }, []);
  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true); setError("");
    try {
      const account = await signIn(email.trim(), password);
      setPassword("");
      if (!account) throw new Error("Please sign in again.");
      onSignedIn(account);
    } catch (e) { setPassword(""); setError(message(e)); } finally { setBusy(false); }
  }
  // A quiet theme switch: an outline on the page itself, never a coloured plate.
  const themeButton = (tone: "page" | "header") => (
    <MotionPress accessibilityRole="button" accessibilityLabel={p.isDark ? "Switch to light mode" : "Switch to dark mode"} onPress={onTheme}
      style={[ui.iconButton, tone === "page" ? { borderColor: p.border, backgroundColor: p.surface } : { borderColor: header.border, backgroundColor: header.surface }]}>
      <Feather name={p.isDark ? "sun" : "moon"} size={19} color={tone === "page" ? p.text : header.text} />
    </MotionPress>
  );
  const items = creating ? [] : [
    <View key="title" style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: desktop ? 34 : 28, lineHeight: desktop ? 40 : 34 }]}>Sign in</Text>
      <Text style={[ui.body, { color: p.muted }]}>Use the email your administrator approved for your workspace.</Text>
    </View>,
    ...(notice ? [<View key="notice" accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, backgroundColor: p.successWash, alignItems: "flex-start" }]}>
      <Feather name="check-circle" size={16} color={p.success} style={{ marginTop: 2 }} />
      <Text style={[ui.small, { color: p.text, flex: 1 }]}>{notice}</Text>
    </View>] : []),
    <Input key="email" label="Email" value={email} onChange={setEmail} p={p} kind="email" />,
    <Input key="password" label="Password" value={password} onChange={setPassword} p={p} kind="password" onSubmit={() => void submit()} />,
    ...(error ? [<Problem key="error" p={p} text={error} />] : []),
    <Primary key="submit" p={p} label={busy ? "Signing in…" : "Sign in"} busy={busy} disabled={busy || !email.trim() || !password} onPress={() => void submit()} />,
    <LegalConsent key="consent" p={p} />,
    <TextLink key="forgot" p={p} label="Forgot your password?" onPress={() => void Linking.openURL((liveApiOrigin() ?? "") + "/reset-password").catch(e => setError(message(e)))} />,
    canRegister ? (
      <MotionPress key="register" accessibilityRole="button" onPress={() => { setCreating(true); setError(""); }} style={[ui.between, { minHeight: 54, paddingHorizontal: 20, borderRadius: 18, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.surface }]}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>New here? Create an account</Text>
        <Feather name="user-plus" size={18} color={p.primary} />
      </MotionPress>
    ) : (
      <View key="register" style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, alignItems: "flex-start" }]}>
        <Feather name="user-plus" size={16} color={p.primary} style={{ marginTop: 2 }} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>New to Recharge? Ask your administrator to add you. They’ll send you a link to choose your password.</Text>
      </View>
    ),
    <View key="lockout" style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, backgroundColor: p.wash, alignItems: "flex-start" }]}>
      <Feather name="shield" size={16} color={p.primary} style={{ marginTop: 2 }} />
      <Text style={[ui.small, { color: p.text, flex: 1 }]}>Five incorrect passwords pause sign-in for 24 hours. Password reset stays available.</Text>
    </View>,
  ];
  const form = creating ? <CreateAccount p={p} desktop={desktop} onBack={address => { setCreating(false); if (address) setEmail(address); }} /> : (
    <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 18 }}>
      {items.map((item, i) => <Stagger key={item.key} index={i + 2}>{item}</Stagger>)}
    </View>
  );
  if (desktop) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: p.background }}>
        {/* The brand panel stays forest in both themes: the glow and the forest logo artwork are
            drawn for a forest canvas, and bone lettering keeps its contrast on it. */}
        <View style={{ flex: 1, maxWidth: 640, backgroundColor: darkBrandCanvas, paddingHorizontal: 48, paddingVertical: 44, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.9 }}><HeroGlow palette={p} /></View>
          <Rise index={0}><CompanyLogo palette={p} variant="dark" width={168} /></Rise>
          {/* Words and the showcase sit together in the middle, so the panel never has a gap. */}
          <View style={{ flex: 1, justifyContent: "center", gap: 34, paddingTop: 24 }}>
            <View style={{ gap: 16 }}>
              <Rise index={1}><Text style={{ color: "#FAF7F0", fontSize: 46, lineHeight: 52, fontWeight: "700", letterSpacing: -1.6 }}>{creating ? "Welcome." : "Welcome back."}</Text></Rise>
              <Rise index={2}><Text style={{ color: "#D3E0D8", fontSize: 17, lineHeight: 26, maxWidth: 420 }}>Your properties, stays, cleans and repairs, together in one place.</Text></Rise>
              <Rise index={3}><TeamChips /></Rise>
            </View>
            <Showcase panel={Math.min(640, width / 2) - 96} />
          </View>
          <Rise index={8}>
            <View style={[ui.row, { gap: 12, paddingTop: 18, borderTopWidth: 1, borderTopColor: "rgba(167,217,193,0.18)" }]}>
              <Text style={{ color: "#A7D9C1", fontSize: 11, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase", flex: 1 }}>Recharge · Scotland</Text>
              <Text style={{ color: "#C9D7CF", fontSize: 12 }}>One standard, every stage</Text>
            </View>
          </Rise>
        </View>
        <View style={{ flex: 1, overflow: "hidden" }}>
          <PageGlow p={p} />
          <View style={{ alignItems: "flex-end", padding: 20 }}>{themeButton("page")}</View>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 32, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
            <View style={[{ width: "100%", maxWidth: 500, alignSelf: "center", padding: 36, borderRadius: 28, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface },
              Platform.OS === "web" ? ({ boxShadow: p.isDark ? "0 40px 80px -48px rgba(0,0,0,.8)" : "0 40px 80px -48px rgba(21,45,40,.45)" } as object) : null]}>{form}</View>
          </ScrollView>
        </View>
      </View>
    );
  }
  const t = designTokens[p.isDark ? "dark" : "light"];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.background }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: p.header, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 64, overflow: "hidden" }}>
        <Rise index={0}><View style={ui.between}><CompanyLogo palette={header} width={width < 360 ? 112 : 144} />{themeButton("header")}</View></Rise>
        <View style={{ marginTop: 26, gap: 8, paddingRight: 140 }}>
          <Rise index={1}><Text style={{ color: p.headerText, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -1 }}>{creating ? "Welcome." : "Welcome back."}</Text></Rise>
          <Rise index={2}><Text style={{ color: p.headerMuted, fontSize: 14, lineHeight: 21 }}>Your properties and work, together in one place.</Text></Rise>
        </View>
        <View pointerEvents="none" style={{ position: "absolute", right: -6, bottom: 20 }}><ChargeScene width={150} /></View>
        <Svg pointerEvents="none" width="100%" height={44} viewBox="0 0 390 44" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: -1 }}>
          <Path d="M0 8 C 110 50, 250 46, 390 2 L390 44 L0 44 Z" fill={p.isDark ? "#2E6B5E" : "#A7D9C1"} opacity={0.35} />
          <Path d="M0 18 C 120 54, 260 50, 390 12 L390 44 L0 44 Z" fill={t.background} />
        </Svg>
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>{form}</View>
    </ScrollView>
  );
}

const native = Platform.OS !== "web";
// The sign-in's opening: logo, words and team chips rise into place one after another, once.
function Rise({ index, children }: { index: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) { progress.setValue(1); return; }
    const a = Animated.timing(progress, { toValue: 1, duration: motionTokens.reveal + 120, delay: 120 + index * 110, easing: motionTokens.entrance, useNativeDriver: native });
    a.start(); return () => a.stop();
  }, [index, progress, reduced]);
  return <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>{children}</Animated.View>;
}
// A slow, endless 0 → 1 → 0 loop for ambient movement. Still when reduced motion is on.
function useLoop(duration: number, delay = 0) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) { value.setValue(0); return; }
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, { toValue: 1, duration, easing: ease, useNativeDriver: native }),
      Animated.timing(value, { toValue: 0, duration, easing: ease, useNativeDriver: native }),
    ]));
    loop.start(); return () => loop.stop();
  }, [duration, delay, value, reduced]);
  return value;
}
// The house and flats float gently on a charging glow that breathes beneath them.
function ChargeScene({ width }: { width: number }) {
  const float = useLoop(2600), pulse = useLoop(1800, 300);
  const glow = width * 0.9;
  return (
    <View style={{ width, height: width * 0.75, alignItems: "center", justifyContent: "flex-end" }}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", bottom: -glow * 0.22, width: glow, height: glow * 0.5,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }), transform: [{ scaleX: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.06] }) }] }}>
        <Svg width="100%" height="100%" viewBox="0 0 100 50"><Defs><RadialGradient id="charge-glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#A7D9C1" stopOpacity={0.42} /><Stop offset="1" stopColor="#A7D9C1" stopOpacity={0} /></RadialGradient></Defs>
          <Ellipse cx={50} cy={25} rx={50} ry={25} fill="url(#charge-glow)" /></Svg>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }}><HomeScene width={width} /></Animated.View>
    </View>
  );
}
// A glimpse of the workspace at work: activity cards float beside the house, one lit at a time.
const ACTIVITY: { icon: "check-circle" | "tool" | "message-circle" | "file-text"; title: string; detail: string }[] = [
  { icon: "check-circle", title: "Clean accepted", detail: "Ready for guests" },
  { icon: "tool", title: "Repair booked", detail: "Boiler · Tue 10:00" },
  { icon: "message-circle", title: "Guest answered", detail: "Replied in 3 min" },
  { icon: "file-text", title: "Statement ready", detail: "Owner payout" },
];
function Showcase({ panel }: { panel: number }) {
  // Cards and picture each get their own column, so neither ever sits on top of the other.
  const cards = Math.round(Math.max(200, Math.min(250, panel * 0.5))), scene = Math.round(Math.max(150, Math.min(300, panel - cards - 20)));
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => { if (reduced) return; const t = setInterval(() => setActive(a => (a + 1) % ACTIVITY.length), 2600); return () => clearInterval(t); }, [reduced]);
  return (
    <View style={[ui.row, { gap: 20, alignItems: "center" }]}>
      <View style={{ width: cards, gap: 10 }}>
        {ACTIVITY.map((item, i) => <Rise key={item.title} index={4 + i}><ActivityCard {...item} index={i} lit={reduced ? i === 0 : active === i} /></Rise>)}
      </View>
      <View style={{ flex: 1, alignItems: "center" }}><ChargeScene width={scene} /></View>
    </View>
  );
}
function ActivityCard({ icon, title, detail, index, lit }: { icon: "check-circle" | "tool" | "message-circle" | "file-text"; title: string; detail: string; index: number; lit: boolean }) {
  const bob = useLoop(2400 + index * 300, index * 400);
  const reduced = useReducedMotion();
  const [glow] = useState(() => new Animated.Value(lit ? 1 : 0));
  useEffect(() => { const a = Animated.timing(glow, { toValue: lit ? 1 : 0, duration: reduced ? 0 : motionTokens.page + 160, easing: motionTokens.standard, useNativeDriver: false }); a.start(); return () => a.stop(); }, [lit, glow, reduced]);
  return (
    <Animated.View style={[ui.row, { gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1,
      borderColor: glow.interpolate({ inputRange: [0, 1], outputRange: ["rgba(167,217,193,0.18)", "rgba(167,217,193,0.6)"] }),
      backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: ["rgba(250,247,240,0.05)", "rgba(250,247,240,0.12)"] }),
      transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] },
      Platform.OS === "web" ? ({ backdropFilter: "blur(6px)" } as object) : null]}>
      <Animated.View style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center",
        backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: ["rgba(167,217,193,0.14)", "rgba(167,217,193,0.3)"] }) }}>
        <Feather name={icon} size={16} color="#A7D9C1" />
      </Animated.View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ color: "#FAF7F0", fontSize: 13, fontWeight: "700" }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: "#C9D7CF", fontSize: 12 }}>{detail}</Text>
      </View>
    </Animated.View>
  );
}
// The four teams, each with a soft light that passes along them in turn.
function TeamChips() {
  const teams: { label: string; icon: "home" | "droplet" | "tool" | "pie-chart" }[] = [
    { label: "Stays", icon: "home" }, { label: "Cleans", icon: "droplet" }, { label: "Ready", icon: "tool" }, { label: "Accounts", icon: "pie-chart" }];
  return (
    <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
      {teams.map((team, i) => <TeamChip key={team.label} {...team} index={i} />)}
    </View>
  );
}
function TeamChip({ label, icon, index }: { label: string; icon: "home" | "droplet" | "tool" | "pie-chart"; index: number }) {
  const light = useLoop(1400, index * 700);
  return (
    <Animated.View style={[ui.row, { gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: "rgba(167,217,193,.35)",
      backgroundColor: "rgba(250,247,240,.06)", opacity: light.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }) }]}>
      <Feather name={icon} size={14} color="#A7D9C1" />
      <Text style={{ color: "#FAF7F0", fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Animated.View>
  );
}
// A faint mint light drifting in the corner of the sign-in side, so it shares the brand panel's glow.
function PageGlow({ p }: { p: Palette }) {
  const drift = useLoop(7000);
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", right: -260, top: -300, width: 720, height: 720,
      transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -40] }) }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) }] }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100"><Defs><RadialGradient id="page-glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={p.isDark ? "#3F8A75" : "#A7D9C1"} stopOpacity={p.isDark ? 0.28 : 0.45} /><Stop offset="1" stopColor={p.isDark ? "#3F8A75" : "#A7D9C1"} stopOpacity={0} /></RadialGradient></Defs>
        <Circle cx={50} cy={50} r={50} fill="url(#page-glow)" /></Svg>
    </Animated.View>
  );
}
