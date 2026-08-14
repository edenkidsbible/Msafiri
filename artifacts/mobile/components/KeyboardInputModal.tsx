/**
 * KeyboardInputModal
 *
 * A bottom-sheet modal for text entry. Slides up from the bottom of the screen
 * so the input is always above the keyboard and never hidden behind it.
 *
 * Usage:
 *   const [modalVisible, setModalVisible] = useState(false);
 *   const [draft, setDraft] = useState(value);
 *
 *   <KeyboardInputModal
 *     visible={modalVisible}
 *     label="Full name"
 *     value={draft}
 *     onChangeText={setDraft}
 *     onDone={() => { onChangeText(draft); setModalVisible(false); }}
 *   />
 *   <TouchableOpacity onPress={() => { setDraft(value); setModalVisible(true); }}>
 *     ...
 *   </TouchableOpacity>
 */
import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type KeyboardTypeOptions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export interface KeyboardInputModalProps {
  visible: boolean;
  /** Label shown at the top of the panel */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Called when user taps the Done button or submits via keyboard — commit the draft */
  onDone: () => void;
  /**
   * Called when the user dismisses without confirming (backdrop tap or Android
   * back button). Falls back to `onDone` when not provided so existing callers
   * that treat dismiss and done identically are unaffected.
   */
  onCancel?: () => void;
  placeholder?: string;
  multiline?: boolean;
  /** Override default input height (default 52, multiline 120) */
  inputHeight?: number;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}

export function KeyboardInputModal({
  visible,
  label,
  value,
  onChangeText,
  onDone,
  onCancel,
  placeholder,
  multiline,
  inputHeight,
  keyboardType,
  autoCapitalize,
}: KeyboardInputModalProps) {
  const handleDismiss = onCancel ?? onDone;
  const c = useColors();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  // Auto-focus after the slide animation settles
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => inputRef.current?.focus(), 160);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const resolvedHeight = inputHeight ?? (multiline ? 130 : 52);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.kavContainer}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Semi-transparent backdrop — tap = dismiss (cancel if onCancel provided) */}
        <TouchableWithoutFeedback onPress={handleDismiss}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* Input panel */}
        <View
          style={[
            styles.panel,
            {
              backgroundColor: c.card,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 16) + 4,
            },
          ]}
        >
          {/* Drag handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Toolbar: label + Done button */}
          <View style={styles.toolbar}>
            <Text style={[styles.labelText, { color: c.foreground }]} numberOfLines={1}>
              {label}
            </Text>
            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: c.primary }]}
              onPress={onDone}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Text input */}
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              {
                backgroundColor: c.background,
                borderColor: c.border,
                color: c.foreground,
                height: resolvedHeight,
                textAlignVertical: multiline ? "top" : "center",
                paddingTop: multiline ? 14 : 0,
              },
            ]}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={c.mutedForeground}
            keyboardType={keyboardType ?? "default"}
            multiline={multiline}
            autoCapitalize={autoCapitalize ?? "sentences"}
            returnKeyType={multiline ? "default" : "done"}
            onSubmitEditing={multiline ? undefined : onDone}
            autoFocus
            scrollEnabled={multiline}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kavContainer: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },

  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
  },

  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },

  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 12,
  },
  labelText: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  doneBtn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 12,
  },
  doneBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingBottom: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
});
