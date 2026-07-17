import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const DISCLAIMER_KEY = "course_disclaimer_agreed";

interface Props {
  children: React.ReactNode;
}

export default function CourseDisclaimerModal({ children }: Props) {
  const colors = useColors();
  const [checked, setChecked] = useState(false);
  const [agreed, setAgreed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DISCLAIMER_KEY).then((val) => {
      setAgreed(val === "1");
      setChecked(true);
    });
  }, []);

  const handleAgree = async () => {
    await AsyncStorage.setItem(DISCLAIMER_KEY, "1");
    setAgreed(true);
  };

  // Not yet read from storage — render nothing to avoid flash
  if (!checked) return null;

  if (agreed) return <>{children}</>;

  return (
    <>
      {/* Render children underneath (blurred / hidden) but show modal on top */}
      <Modal
        visible
        animationType="slide"
        transparent={false}
        presentationStyle="fullScreen"
      >
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="book-open" size={40} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            Before you continue
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.body, { color: colors.foreground }]}>
              The Msafiri Kenya driving course is a refresher resource designed to
              help you review key road rules, traffic signs, and safe driving
              practices.
            </Text>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="alert-triangle" size={18} color="#F59E0B" style={styles.cardIcon} />
              <Text style={[styles.cardText, { color: colors.foreground }]}>
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>
                  This course is not a substitute{" "}
                </Text>
                for attending a licensed driving school, obtaining a valid driver's
                licence, or complying with NTSA requirements. It does not certify
                you to drive.
              </Text>
            </View>

            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Always drive in accordance with the Traffic Act and exercise good
              judgement on the road. Msafiri Kenya is not liable for any decisions
              made based on course content.
            </Text>
          </ScrollView>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.primary }]}
            onPress={handleAgree}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>I understand, continue</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginBottom: 16,
    textAlign: "center",
  },
  scroll: {
    width: "100%",
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 16,
    gap: 14,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardIcon: {
    marginTop: 1,
  },
  cardText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  btn: {
    marginTop: 24,
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
