import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import Svg, { Path } from "react-native-svg";
import * as Linking from "expo-linking";
import { Text } from "./Typography";
import { CompanyLogo } from "./CompanyLogo";
import { HomeScene } from "./HomeScene";
import { HeroGlow } from "./TodayAnalytics";
import { MotionPress } from "./motion";
import { headerPalette, ui, type Palette } from "./theme";
import { accountStep, liveApiOrigin, registrationOpen, signIn } from "./backend/client";
import { darkBrandCanvas, designTokens } from "../../lib/design-tokens";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

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
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      <View style={[ui.row, { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, paddingLeft: 14, gap: 10 }]}>
        <Feather name={k.icon} size={17} color={p.muted} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          returnKeyType={secure ? "go" : "next"}
          autoCapitalize={kind === "name" ? "words" : "none"}
          autoCorrect={false}
          autoComplete={k.autoComplete}
          keyboardType={email ? "email-address" : kind === "code" ? "number-pad" : "default"}
          secureTextEntry={secure && hidden}
          placeholder={k.placeholder}
          placeholderTextColor={p.muted}
          style={{ flex: 1, minHeight: 50, color: p.text, fontSize: 15, fontFamily: "Montserrat_500Medium" }}
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
    <MotionPress accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.between, { minHeight: 54, paddingHorizontal: 20, borderRadius: 18, backgroundColor: p.primary, opacity: disabled ? 0.55 : 1 }]}>
      <Text style={{ color: p.onPrimary, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      {busy ? <ActivityIndicator color={p.onPrimary} /> : <Feather name="arrow-right" size={18} color={p.onPrimary} />}
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
export function LiveSignIn({ palette: p, onSignedIn, onTheme }: { palette: Palette; onSignedIn: (account: WorkspaceAccount) => void; onTheme: () => void }) {
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
  const themeButton = (
    <MotionPress accessibilityRole="button" accessibilityLabel={p.isDark ? "Switch to light mode" : "Switch to dark mode"} onPress={onTheme} style={[ui.iconButton, { borderColor: header.border, backgroundColor: header.surface }]}>
      <Feather name={p.isDark ? "sun" : "moon"} size={19} color={header.text} />
    </MotionPress>
  );
  const form = creating ? <CreateAccount p={p} desktop={desktop} onBack={address => { setCreating(false); if (address) setEmail(address); }} /> : (
    <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 18 }}>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: desktop ? 34 : 28, lineHeight: desktop ? 40 : 34 }]}>Sign in</Text>
        <Text style={[ui.body, { color: p.muted }]}>Use the email your administrator approved for your workspace.</Text>
      </View>
      <Input label="Email" value={email} onChange={setEmail} p={p} kind="email" />
      <Input label="Password" value={password} onChange={setPassword} p={p} kind="password" onSubmit={() => void submit()} />
      {!!error && <Problem p={p} text={error} />}
      <Primary p={p} label={busy ? "Signing in…" : "Sign in"} busy={busy} disabled={busy || !email.trim() || !password} onPress={() => void submit()} />
      <TextLink p={p} label="Forgot your password?" onPress={() => void Linking.openURL((liveApiOrigin() ?? "") + "/reset-password").catch(e => setError(message(e)))} />
      {canRegister ? (
        <MotionPress accessibilityRole="button" onPress={() => { setCreating(true); setError(""); }} style={[ui.between, { minHeight: 54, paddingHorizontal: 20, borderRadius: 18, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.surface }]}>
          <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>New here? Create an account</Text>
          <Feather name="user-plus" size={18} color={p.primary} />
        </MotionPress>
      ) : (
        <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, alignItems: "flex-start" }]}>
          <Feather name="user-plus" size={16} color={p.primary} style={{ marginTop: 2 }} />
          <Text style={[ui.small, { color: p.text, flex: 1 }]}>New to Recharge? Ask your administrator to add you. They’ll send you a link to choose your password.</Text>
        </View>
      )}
      <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, backgroundColor: p.wash, alignItems: "flex-start" }]}>
        <Feather name="shield" size={16} color={p.primary} style={{ marginTop: 2 }} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>Five incorrect passwords pause sign-in for 24 hours. Password reset stays available.</Text>
      </View>
    </View>
  );
  if (desktop) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: p.background }}>
        {/* The brand panel stays forest in both themes: the glow and the forest logo artwork are
            drawn for a forest canvas, and bone lettering keeps its contrast on it. */}
        <View style={{ flex: 1, maxWidth: 640, backgroundColor: darkBrandCanvas, padding: 48, justifyContent: "space-between", overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.9 }}><HeroGlow palette={p} /></View>
          <CompanyLogo palette={p} variant="dark" width={168} />
          <View style={{ gap: 14 }}>
            <Text style={{ color: "#FAF7F0", fontSize: 46, lineHeight: 52, fontWeight: "700", letterSpacing: -1.6 }}>{creating ? "Welcome." : "Welcome back."}</Text>
            <Text style={{ color: "#D3E0D8", fontSize: 17, lineHeight: 26, maxWidth: 420 }}>Your properties, stays, cleans and repairs, together in one place.</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}><HomeScene width={300} /></View>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ alignItems: "flex-end", padding: 20 }}><View style={{ backgroundColor: p.header, borderRadius: 16 }}>{themeButton}</View></View>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 32, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">{form}</ScrollView>
        </View>
      </View>
    );
  }
  const t = designTokens[p.isDark ? "dark" : "light"];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.background }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: p.header, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 64, overflow: "hidden" }}>
        <View style={ui.between}><CompanyLogo palette={header} width={width < 360 ? 112 : 144} />{themeButton}</View>
        <View style={{ marginTop: 26, gap: 8, paddingRight: 140 }}>
          <Text style={{ color: p.headerText, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -1 }}>{creating ? "Welcome." : "Welcome back."}</Text>
          <Text style={{ color: p.headerMuted, fontSize: 14, lineHeight: 21 }}>Your properties and work, together in one place.</Text>
        </View>
        <View pointerEvents="none" style={{ position: "absolute", right: -6, bottom: 20 }}><HomeScene width={150} /></View>
        <Svg pointerEvents="none" width="100%" height={44} viewBox="0 0 390 44" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: -1 }}>
          <Path d="M0 8 C 110 50, 250 46, 390 2 L390 44 L0 44 Z" fill={p.isDark ? "#2E6B5E" : "#A7D9C1"} opacity={0.35} />
          <Path d="M0 18 C 120 54, 260 50, 390 12 L390 44 L0 44 Z" fill={t.background} />
        </Svg>
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>{form}</View>
    </ScrollView>
  );
}
