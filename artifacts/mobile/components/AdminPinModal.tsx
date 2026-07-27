import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AdminPinModal({ visible, onClose, onSuccess }: Props) {
  const c = useColors();
  const { adminLogin } = useApp();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    setPin("");
    onClose();
  };

  const handleLogin = async () => {
    const trimmed = pin.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await adminLogin(trimmed);
      setPin("");
      onSuccess?.();
      onClose();
    } catch (err: any) {
      const raw = err?.message ?? "Login failed";
      Alert.alert(
        "Admin Login Failed",
        raw === "Incorrect PIN"
          ? "Incorrect PIN. Please try again."
          : raw.startsWith("Admin PIN not configured")
            ? "Admin PIN has not been configured on this server yet."
            : raw,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.backdrop}
      >
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <View style={styles.iconCircle}>
              <Ionicons name="shield-checkmark" size={28} color="#1565C0" />
            </View>
          </View>

          <Text style={[styles.title, { color: c.foreground }]}>Admin Login</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            Enter your admin PIN to enable moderator controls on the map.
          </Text>

          <TextInput
            style={[styles.input, { color: c.foreground, borderColor: c.border, backgroundColor: c.background }]}
            placeholder="Enter PIN"
            placeholderTextColor={c.mutedForeground}
            secureTextEntry
            keyboardType="number-pad"
            value={pin}
            onChangeText={setPin}
            onSubmitEditing={handleLogin}
            returnKeyType="done"
            autoFocus
          />

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: c.border }]}
              onPress={handleClose}
              disabled={loading}
            >
              <Text style={[styles.cancelTxt, { color: c.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.loginBtn, { opacity: loading || !pin.trim() ? 0.55 : 1 }]}
              onPress={handleLogin}
              disabled={loading || !pin.trim()}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={styles.loginTxt}>Login</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 22,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconWrap: { alignItems: "center", marginBottom: 4 },
  iconCircle: {
    width: 60, height: 60, borderRadius: 20,
    backgroundColor: "#E3F2FD",
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 18, marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 22,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 5,
    textAlign: "center",
    marginVertical: 4,
  },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  loginBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    backgroundColor: "#1565C0",
  },
  loginTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFF" },
});
