import { StateGraphic } from "./StateGraphic";
import { Text } from "./Typography";
import { useEffect, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { ui, type Palette } from "./theme";
import { Entrance, MotionPress as Pressable, useReducedMotion } from "./motion";

export type Profile = {
  displayName: string;
  avatar: keyof typeof avatarColors;
  // Optional picture chosen from the device, kept for this session only.
  photo?: string;
};
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
// Earthy avatar choices that sit with the bone and forest palette.
export const avatarColors = {
  forest: "#1C3934",
  sage: "#1F5F55",
  ocean: "#3B5866",
  plum: "#5B4A5E",
  clay: "#8E3F38",
  slate: "#4E6259",
};
export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "YOU"
  );
}
export function Avatar({
  profile,
  size = 44,
  backgroundColor,
  textColor = "#ffffff",
}: {
  profile: Profile;
  size?: number;
  backgroundColor?: string;
  textColor?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: backgroundColor || avatarColors[profile.avatar],
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {profile.photo ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: profile.photo }}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      ) : (
        <Text
          style={{ color: textColor, fontWeight: "700", fontSize: size * 0.3 }}
        >
          {initials(profile.displayName)}
        </Text>
      )}
    </View>
  );
}
function accountOrigin() {
  const value = process.env.EXPO_PUBLIC_ACCOUNT_API_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
const origin = accountOrigin();
async function accountRequest(body: object, token?: string) {
  if (!origin)
    throw new Error(
      "Live registration is awaiting configuration. You can customize your preview profile now.",
    );
  const response = await fetch(`${origin}/api/mobile/account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "Account setup is unavailable. Please try again.",
    );
  return data;
}
export function AccountSetup({
  mode,
  palette: p,
  current,
  onClose,
  onProfile,
}: {
  mode: "register" | "preview";
  palette: Palette;
  current: Profile;
  onClose: () => void;
  onProfile: (profile: Profile) => void;
}) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(mode === "preview" ? 3 : 0);
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [profile, setProfile] = useState(current);
  const [enabled, setEnabled] = useState(false);
  const [phoneEnabled, setPhoneEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const token = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (origin && mode === "register")
      fetch(`${origin}/api/mobile/account`, {
        signal: AbortSignal.timeout(10_000),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (alive.current) {
            setEnabled(data?.enabled === true);
            setPhoneEnabled(data?.phoneEnabled === true);
          }
        })
        .catch(() => {});
    return () => {
      alive.current = false;
      token.current = null;
    };
  }, [mode]);
  const changeMethod = (value: "email" | "phone") => {
    setMethod(value);
    setAddress("");
    setError("");
  };
  const field = {
    ...ui.input,
    color: p.text,
    backgroundColor: p.surface,
    borderColor: p.border,
  };
  const label = { ...ui.small, color: p.muted };
  const [photoError, setPhotoError] = useState("");
  const pickPhoto = async () => {
    setPhotoError("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const bytes =
        asset.fileSize ?? (asset as { file?: { size?: number } }).file?.size ?? 0;
      if (asset.mimeType && !asset.mimeType.startsWith("image/")) {
        setPhotoError("Choose an image file, such as JPG, PNG or HEIC.");
        return;
      }
      if (bytes > MAX_PHOTO_BYTES) {
        setPhotoError(
          `That picture is ${(bytes / 1024 / 1024).toFixed(1)} MB. Choose one up to 8 MB.`,
        );
        return;
      }
      setProfile((current) => ({ ...current, photo: asset.uri }));
    } catch {
      setPhotoError("Your photos could not be opened. Please try again.");
    }
  };
  const next = async () => {
    setError("");
    if (step === 0) {
      const trimmed = address.trim();
      if (
        !(method === "email"
          ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 254
          : /^\+[1-9]\d{7,14}$/.test(trimmed))
      ) {
        setError(
          method === "email"
            ? "Enter a valid email address."
            : "Include the country code, for example +447123456789.",
        );
        return;
      }
      setAddress(method === "email" ? trimmed.toLowerCase() : trimmed);
      setStep(1);
      return;
    }
    if (step === 1) {
      const bytes = [...password].reduce((total, char) => {
        const point = char.codePointAt(0)!;
        return (
          total + (point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4)
        );
      }, 0);
      if (password.length < 12 || password.length > 72 || bytes > 72) {
        setError("Use at least 12 characters and no more than 72 bytes.");
        return;
      }
      if (password !== confirmation) {
        setError("Your passwords do not match.");
        return;
      }
    }
    if (step === 2 && !/^\d{6,8}$/.test(code)) {
      setError("Enter the verification code from your email or SMS.");
      return;
    }
    if (
      step === 3 &&
      (profile.displayName.trim().length < 2 ||
        profile.displayName.trim().length > 60 ||
        /[\u0000-\u001f\u007f]/.test(profile.displayName))
    ) {
      setError("Enter a name between 2 and 60 characters.");
      return;
    }
    setBusy(true);
    try {
      if (step === 1) {
        const result = await accountRequest({
          action: "register",
          method,
          address,
          password,
        });
        if (!alive.current) return;
        setPassword("");
        setConfirmation("");
        setMessage(result.message);
        setStep(2);
      } else if (step === 2) {
        const result = await accountRequest({
          action: "verify",
          method,
          address,
          code,
        });
        if (!alive.current) return;
        if (typeof result.accessToken !== "string")
          throw new Error("Verification could not be completed.");
        token.current = result.accessToken;
        setCode("");
        setMessage("");
        setStep(3);
      } else if (step === 3) {
        const appearance = {
          ...profile,
          displayName: profile.displayName.trim(),
        };
        if (mode === "register") {
          if (!token.current)
            throw new Error("Verify your contact details first.");
          await accountRequest(appearance, token.current);
        }
        if (!alive.current) return;
        token.current = null;
        onProfile(appearance);
        setStep(4);
      }
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : "Please try again.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const { width: windowWidth } = useWindowDimensions();
  const desktop = windowWidth >= 768;
  const close = () => {
    alive.current = false;
    token.current = null;
    setPassword("");
    setConfirmation("");
    setCode("");
    onClose();
  };
  return (
    <Modal
      visible
      transparent
      animationType={reduced ? "none" : "slide"}
      onRequestClose={close}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        {...(Platform.OS === "web" ? { dataSet: { overlay: "blur" } } : {})}
        style={[ui.modalOverlay, { backgroundColor: p.overlay, justifyContent: desktop ? "center" : "flex-end", alignItems: desktop ? "center" : undefined }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <SafeAreaView
          edges={["bottom"]}
          style={[
            ui.modalSheet,
            {
              backgroundColor: p.surface,
              maxHeight: "95%",
              width: desktop ? Math.min(600, windowWidth - 48) : "100%",
              borderRadius: desktop ? 30 : undefined,
              borderWidth: desktop ? 1 : 0,
              borderColor: p.border,
              ...(Platform.OS === "web" ? { boxShadow: "0 40px 100px -30px rgba(8, 22, 18, 0.55)" } : {}),
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={[ui.row, { gap: 14 }]}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.header, alignItems: "center", justifyContent: "center" }}>
              <Feather name={mode === "preview" ? "user" : "user-plus"} size={19} color={p.headerText} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text, fontSize: 20, letterSpacing: -0.6 }]}
              >
                {mode === "preview"
                  ? "Your preview profile"
                  : "Create your account"}
              </Text>
              <Text style={[ui.small, { color: p.muted }]}>
                {mode === "preview" ? "Name and avatar for this preview" : "A few quick steps to get started"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close account setup"
              disabled={busy}
              onPress={close}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}
            >
              <Feather name="x" size={18} color={p.text} />
            </Pressable>
          </View>
          <View style={{ height: 1, backgroundColor: p.border, marginHorizontal: -22 }} />
          <ScrollView
            contentContainerStyle={{ gap: 16, paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <Entrance trigger={String(step)} style={{ gap: 16 }}>
              {mode === "register" && step < 4 && (
                <View
                  style={[ui.row, { gap: 6 }]}
                  accessibilityLabel={`Account setup, step ${step + 1} of 4`}
                >
                  {[0, 1, 2, 3].map((index) => (
                    <View
                      key={index}
                      style={{
                        height: 4,
                        flex: 1,
                        borderRadius: 3,
                        backgroundColor: index <= step ? p.primary : p.border,
                      }}
                    />
                  ))}
                </View>
              )}
              {step < 4 && (
                <Text style={[ui.eyebrow, { color: p.muted }]}>
                  {mode === "preview"
                    ? "PREVIEW PROFILE"
                    : `STEP ${step + 1} OF 4`}
                </Text>
              )}
              {step === 0 && (
                <>
                  <Text style={[ui.title, { color: p.text }]}>
                    Start with one contact.
                  </Text>
                  <Text style={label}>
                    Register with your email address or phone number. You only
                    need one.
                  </Text>
                  <View style={[ui.row, { gap: 10 }]}>
                    {(["email", "phone"] as const).map((value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: method === value }}
                        onPress={() => changeMethod(value)}
                        style={[
                          ui.button,
                          {
                            flex: 1,
                            backgroundColor:
                              method === value ? p.primary : p.wash,
                          },
                        ]}
                      >
                        <Feather
                          name={value === "email" ? "mail" : "smartphone"}
                          size={17}
                          color={method === value ? p.onPrimary : p.text}
                        />
                        <Text
                          style={{
                            color: method === value ? p.onPrimary : p.text,
                            fontWeight: "600",
                          }}
                        >
                          {value === "email" ? "Email" : "Phone"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={label}>
                    {method === "email"
                      ? "Email address"
                      : "Phone number with country code"}
                  </Text>
                  <TextInput
                    accessibilityLabel={
                      method === "email"
                        ? "Registration email address"
                        : "Registration phone number"
                    }
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={
                      method === "email" ? "email-address" : "phone-pad"
                    }
                    textContentType={
                      method === "email" ? "emailAddress" : "telephoneNumber"
                    }
                    value={address}
                    onChangeText={setAddress}
                    placeholder={
                      method === "email" ? "you@example.com" : "+447123456789"
                    }
                    placeholderTextColor={p.muted}
                    style={field}
                  />
                  {method === "phone" && !phoneEnabled && (
                    <Text style={label}>
                      SMS registration will be available once the SMS provider
                      is connected.
                    </Text>
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  <Text style={[ui.title, { color: p.text }]}>
                    Set your password.
                  </Text>
                  <Text style={label}>{address}</Text>
                  <Text style={label}>
                    Use at least 12 characters. Your password will never be
                    saved on this device.
                  </Text>
                  <TextInput
                    accessibilityLabel="New account password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    style={field}
                    placeholder="Your password"
                    placeholderTextColor={p.muted}
                  />
                  <TextInput
                    accessibilityLabel="Confirm account password"
                    value={confirmation}
                    onChangeText={setConfirmation}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    style={field}
                    placeholder="Confirm your password"
                    placeholderTextColor={p.muted}
                  />
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: showPassword }}
                    onPress={() => setShowPassword(!showPassword)}
                    style={[ui.row, { gap: 9, minHeight: 44 }]}
                  >
                    <Feather
                      name={showPassword ? "eye-off" : "eye"}
                      color={p.text}
                      size={18}
                    />
                    <Text style={label}>
                      {showPassword ? "Hide" : "Show"} passwords
                    </Text>
                  </Pressable>
                </>
              )}
              {step === 2 && (
                <>
                  <Text style={[ui.title, { color: p.text }]}>
                    Verify it is you.
                  </Text>
                  <Text style={label}>{message}</Text>
                  <Text style={label}>
                    Check {address} for your verification code.
                  </Text>
                  <TextInput
                    accessibilityLabel="Account verification code"
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    maxLength={8}
                    textContentType="oneTimeCode"
                    style={field}
                    placeholder="Verification code"
                    placeholderTextColor={p.muted}
                  />
                </>
              )}
              {step === 3 && (
                <>
                  <Text style={[ui.title, { color: p.text }]}>
                    Make it yours.
                  </Text>
                  <View style={{ alignItems: "center", paddingTop: 6, gap: 10 }}>
                    <View>
                      <Avatar profile={profile} size={104} />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={profile.photo ? "Change your profile picture" : "Upload a profile picture"}
                        onPress={pickPhoto}
                        style={{ position: "absolute", right: -2, bottom: -2, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: p.primary, borderWidth: 3, borderColor: p.surface }}
                      >
                        <Feather name="camera" size={16} color={p.onPrimary} />
                      </Pressable>
                    </View>
                    <View style={{ alignItems: "center", gap: 2 }}>
                      <Text numberOfLines={1} style={{ color: p.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.4 }}>
                        {profile.displayName.trim() || "Your name"}
                      </Text>
                      <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase" }}>
                        {mode === "preview" ? "Preview profile" : "Your profile"}
                      </Text>
                    </View>
                    <View style={[ui.row, { gap: 8, flexWrap: "wrap", justifyContent: "center" }]}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={pickPhoto}
                        style={[ui.row, { gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.surface }]}
                      >
                        <Feather name="image" size={16} color={p.text} />
                        <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{profile.photo ? "Change photo" : "Upload photo"}</Text>
                      </Pressable>
                      {!!profile.photo && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => { setPhotoError(""); setProfile({ ...profile, photo: undefined }); }}
                          style={[ui.row, { gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 999 }]}
                        >
                          <Feather name="trash-2" size={16} color={p.muted} />
                          <Text style={{ color: p.muted, fontSize: 14, fontWeight: "600" }}>Remove</Text>
                        </Pressable>
                      )}
                    </View>
                    <Text style={[label, { textAlign: "center" }]}>JPG, PNG or HEIC, up to 8 MB.</Text>
                    {!!photoError && (
                      <Text accessibilityRole="alert" style={[ui.small, { color: p.danger, textAlign: "center" }]}>{photoError}</Text>
                    )}
                  </View>
                  <Text style={label}>Profile name</Text>
                  <TextInput
                    accessibilityLabel="Your profile name"
                    value={profile.displayName}
                    onChangeText={(displayName) =>
                      setProfile({ ...profile, displayName })
                    }
                    maxLength={60}
                    textContentType="name"
                    style={field}
                    placeholder="Your name"
                    placeholderTextColor={p.muted}
                  />
                  <Text style={label}>{profile.photo ? "Fallback colour" : "Or choose a colour"}</Text>
                  <View
                    style={[
                      ui.row,
                      { flexWrap: "wrap", gap: 12, justifyContent: "center" },
                    ]}
                  >
                    {Object.keys(avatarColors).map((value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityLabel={`${value} avatar`}
                        accessibilityState={{
                          checked: profile.avatar === value,
                        }}
                        onPress={() =>
                          setProfile({
                            ...profile,
                            avatar: value as Profile["avatar"],
                          })
                        }
                        style={{
                          padding: 4,
                          borderWidth: 2,
                          borderColor:
                            profile.avatar === value
                              ? p.primary
                              : "transparent",
                          borderRadius: 36,
                        }}
                      >
                        <Avatar
                          profile={{
                            ...profile,
                            photo: undefined,
                            avatar: value as Profile["avatar"],
                          }}
                          size={52}
                        />
                      </Pressable>
                    ))}
                  </View>
                  <Text style={label}>
                    {mode === "preview"
                      ? "This customizes this local preview only. No account will be created."
                      : "Your profile is personal. Workspace access is approved separately by an administrator."}
                  </Text>
                </>
              )}
              {step === 4 && (
                <>
                  <View style={{ alignItems: "center", gap: 16 }}>
                    <StateGraphic palette={p} success />
                    <Avatar profile={profile} size={64} />
                    <Text style={[ui.title, { color: p.text }]}>
                      All set, {profile.displayName.trim().split(" ")[0]}.
                    </Text>
                  </View>
                  <Text style={label}>
                    {mode === "preview"
                      ? "Your preview profile is ready."
                      : "Your account and profile are ready. Private workspace access remains pending administrator approval."}
                  </Text>
                </>
              )}
              {mode === "register" && !enabled && step < 2 && (
                <Text
                  style={[
                    ui.small,
                    {
                      color: p.muted,
                      backgroundColor: p.wash,
                      padding: 12,
                      borderRadius: 12,
                    },
                  ]}
                >
                  Live registration is awaiting secure backend configuration. No
                  email or phone number will be sent until it is connected.
                </Text>
              )}
              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={[ui.small, { color: p.text }]}
                >
                  {error}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={
                  busy ||
                  (step === 1 &&
                    (!enabled || (method === "phone" && !phoneEnabled)))
                }
                accessibilityState={{
                  disabled:
                    busy ||
                    (step === 1 &&
                      (!enabled || (method === "phone" && !phoneEnabled))),
                }}
                onPress={step === 4 ? close : next}
                style={[
                  ui.button,
                  {
                    backgroundColor: p.primary,
                    opacity:
                      busy ||
                      (step === 1 &&
                        (!enabled || (method === "phone" && !phoneEnabled)))
                        ? 0.5
                        : 1,
                  },
                ]}
              >
                <Text style={[ui.buttonText, { color: p.onPrimary }]}>
                  {busy
                    ? "Please wait"
                    : step === 0
                      ? "Continue"
                      : step === 1
                        ? "Send verification code"
                        : step === 2
                          ? "Verify contact"
                          : step === 3
                            ? "Save profile"
                            : "Done"}
                </Text>
              </Pressable>
              {step > 0 && step < 3 && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
                    setError("");
                    setCode("");
                    setStep(step - 1);
                  }}
                  style={ui.button}
                >
                  <Text style={{ color: p.text }}>Back</Text>
                </Pressable>
              )}
            </Entrance>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
