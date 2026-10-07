import { useState } from "react";
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
import { liveApiOrigin, signIn } from "./backend/client";
import { designTokens } from "../../lib/design-tokens";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

function Input({ label, value, onChange, p, secure = false, email = false, onSubmit }: { label: string; value: string; onChange: (value: string) => void; p: Palette; secure?: boolean; email?: boolean; onSubmit?: () => void }) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      <View style={[ui.row, { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, paddingLeft: 14, gap: 10 }]}>
        <Feather name={email ? "mail" : "lock"} size={17} color={p.muted} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          returnKeyType={secure ? "go" : "next"}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={email ? "email" : "current-password"}
          keyboardType={email ? "email-address" : "default"}
          secureTextEntry={secure && hidden}
          placeholder={email ? "you@example.com" : "Your password"}
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

// The live sign-in, in the same forest-and-bone design as the workspace.
export function LiveSignIn({ palette: p, onSignedIn, onTheme }: { palette: Palette; onSignedIn: (account: WorkspaceAccount) => void; onTheme: () => void }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const header = headerPalette(p);
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
  const form = (
    <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 18 }}>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: desktop ? 34 : 28, lineHeight: desktop ? 40 : 34 }]}>Sign in</Text>
        <Text style={[ui.body, { color: p.muted }]}>Use the email your administrator approved for your workspace.</Text>
      </View>
      <Input label="Email" value={email} onChange={setEmail} p={p} email />
      <Input label="Password" value={password} onChange={setPassword} p={p} secure onSubmit={() => void submit()} />
      {!!error && (
        <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}>
          <Feather name="alert-circle" size={16} color={p.waiting} />
          <Text style={[ui.small, { color: p.text, flex: 1 }]}>{error}</Text>
        </View>
      )}
      <MotionPress accessibilityRole="button" accessibilityState={{ disabled: busy || !email.trim() || !password }} disabled={busy || !email.trim() || !password} onPress={() => void submit()} style={[ui.between, { minHeight: 54, paddingHorizontal: 20, borderRadius: 18, backgroundColor: p.primary, opacity: busy || !email.trim() || !password ? 0.55 : 1 }]}>
        <Text style={{ color: p.onPrimary, fontSize: 15, fontWeight: "700" }}>{busy ? "Signing in…" : "Sign in"}</Text>
        {busy ? <ActivityIndicator color={p.onPrimary} /> : <Feather name="arrow-right" size={18} color={p.onPrimary} />}
      </MotionPress>
      <MotionPress accessibilityRole="link" onPress={() => void Linking.openURL((liveApiOrigin() ?? "") + "/reset-password").catch(e => setError(message(e)))} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
        <Text style={{ color: p.primary, fontSize: 14, fontWeight: "600" }}>Forgot your password?</Text>
      </MotionPress>
      <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, backgroundColor: p.wash, alignItems: "flex-start" }]}>
        <Feather name="shield" size={16} color={p.primary} style={{ marginTop: 2 }} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>Five incorrect passwords pause sign-in for 24 hours. Password reset stays available.</Text>
      </View>
    </View>
  );
  if (desktop) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: p.background }}>
        <View style={{ flex: 1, maxWidth: 640, backgroundColor: p.header, padding: 48, justifyContent: "space-between", overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.9 }}><HeroGlow palette={p} /></View>
          <CompanyLogo palette={header} width={168} />
          <View style={{ gap: 14 }}>
            <Text style={{ color: p.headerText, fontSize: 46, lineHeight: 52, fontWeight: "700", letterSpacing: -1.6 }}>Welcome back.</Text>
            <Text style={{ color: p.headerMuted, fontSize: 17, lineHeight: 26, maxWidth: 420 }}>Your properties, stays, cleans and repairs, together in one place.</Text>
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
        <View style={{ marginTop: 26, gap: 8, paddingRight: 120 }}>
          <Text style={{ color: p.headerText, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -1 }}>Welcome back.</Text>
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
