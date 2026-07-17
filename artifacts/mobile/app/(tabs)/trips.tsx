import React, { useEffect, useState, useCallback, useRef } from "react";
import { FLAT_LIST_PROPS } from "@/lib/scrollProps";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";
import TripCard from "@/components/TripCard";
import RouteCheckModal from "@/components/RouteCheckModal";
import {
  SavedPlace,
  PlannedTrip,
  listSavedPlaces,
  createSavedPlace,
  updateSavedPlace,
  deleteSavedPlace,
  listPlannedTrips,
  createPlannedTrip,
  updatePlannedTrip,
  deletePlannedTrip,
} from "@/utils/tripsApi";

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function tripDateStr(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  if (isTomorrow) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

function placeIcon(kind: SavedPlace["kind"]): React.ComponentProps<typeof Ionicons>["name"] {
  if (kind === "home") return "home";
  if (kind === "work") return "briefcase";
  return "location";
}

export default function TripsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    deviceId, tripHistory, clearTripHistory, currentTrip,
    isSharingTrip, shareLink, startSharingTrip, stopSharingTrip, navigationActive,
  } = useApp();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [tab, setTab] = useState<"share" | "planned" | "past">("share");
  const [sharingLoading, setSharingLoading] = useState(false);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [trips, setTrips] = useState<PlannedTrip[]>([]);
  const [loading, setLoading] = useState(true);

  // Saved-place add/edit modal
  const [placeModal, setPlaceModal] = useState(false);
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [placeKind, setPlaceKind] = useState<SavedPlace["kind"]>("custom");
  const [placeSearch, setPlaceSearch] = useState("");
  const [placeResults, setPlaceResults] = useState<GeoResult[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeSelected, setPlaceSelected] = useState<GeoResult | null>(null);
  const [placeSaving, setPlaceSaving] = useState(false);
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Plan-a-trip modal
  const [tripModal, setTripModal] = useState(false);
  const [tripDest, setTripDest] = useState<{ label: string; lat: number; lng: number; savedPlaceId?: string | null } | null>(null);
  const [tripSearch, setTripSearch] = useState("");
  const [tripResults, setTripResults] = useState<GeoResult[]>([]);
  const [tripSearching, setTripSearching] = useState(false);
  const [tripDate, setTripDate] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [tripSaving, setTripSaving] = useState(false);
  const tripTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSharePress = useCallback(async () => {
    if (isSharingTrip) {
      await stopSharingTrip();
      return;
    }
    setSharingLoading(true);
    try {
      const link = await startSharingTrip();
      if (link) {
        await Share.share({
          message: `Follow my live trip 📍\n${link}`,
          url: link,
          title: "Track my trip — Msafiri Kenya",
        });
      }
    } finally {
      setSharingLoading(false);
    }
  }, [isSharingTrip, startSharingTrip, stopSharingTrip]);

  // Route check modal (road conditions for a saved place / planned trip)
  const [routeCheck, setRouteCheck] = useState<{ label: string; lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const [p, t] = await Promise.all([listSavedPlaces(deviceId), listPlannedTrips(deviceId)]);
      setPlaces(p);
      setTrips(t);
    } catch {
      // silently ignore — offline or server unreachable
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Saved place modal helpers ──────────────────────────────────────────

  const openAddPlace = () => {
    setEditingPlace(null);
    setPlaceLabel("");
    setPlaceKind("custom");
    setPlaceSearch("");
    setPlaceResults([]);
    setPlaceSelected(null);
    setPlaceModal(true);
  };

  const openEditPlace = (p: SavedPlace) => {
    setEditingPlace(p);
    setPlaceLabel(p.label);
    setPlaceKind(p.kind);
    setPlaceSearch(p.address ?? "");
    setPlaceResults([]);
    setPlaceSelected({ display: p.address ?? p.label, short: p.label, lat: p.lat, lng: p.lng });
    setPlaceModal(true);
  };

  const runPlaceSearch = async (text: string) => {
    if (text.length < 3) { setPlaceResults([]); return; }
    setPlaceSearching(true);
    try {
      setPlaceResults(await nominatimSearch(text));
    } catch {
      setPlaceResults([]);
    } finally {
      setPlaceSearching(false);
    }
  };

  const handlePlaceSearchChange = (text: string) => {
    setPlaceSearch(text);
    setPlaceSelected(null);
    if (placeTimer.current) clearTimeout(placeTimer.current);
    placeTimer.current = setTimeout(() => runPlaceSearch(text), 500);
  };

  const savePlace = async () => {
    if (!deviceId || !placeLabel.trim() || !placeSelected) return;
    setPlaceSaving(true);
    try {
      if (editingPlace) {
        const updated = await updateSavedPlace(deviceId, editingPlace.id, {
          label: placeLabel.trim(),
          kind: placeKind,
          address: placeSelected.display,
          lat: placeSelected.lat,
          lng: placeSelected.lng,
        });
        setPlaces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const created = await createSavedPlace(deviceId, {
          label: placeLabel.trim(),
          kind: placeKind,
          address: placeSelected.display,
          lat: placeSelected.lat,
          lng: placeSelected.lng,
        });
        setPlaces((prev) => [...prev, created]);
      }
      setPlaceModal(false);
      Keyboard.dismiss();
    } catch {
      Alert.alert("Couldn't save", "Please check your connection and try again.");
    } finally {
      setPlaceSaving(false);
    }
  };

  const removePlace = (p: SavedPlace) => {
    Alert.alert("Delete Saved Place", `Remove "${p.label}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!deviceId) return;
          setPlaces((prev) => prev.filter((x) => x.id !== p.id));
          try {
            await deleteSavedPlace(deviceId, p.id);
          } catch {
            load();
          }
        },
      },
    ]);
  };

  // ── Plan-a-trip modal helpers ───────────────────────────────────────────

  const openPlanTrip = (place?: SavedPlace) => {
    if (place) {
      setTripDest({ label: place.label, lat: place.lat, lng: place.lng, savedPlaceId: place.id });
      setTripSearch(place.label);
    } else {
      setTripDest(null);
      setTripSearch("");
    }
    setTripResults([]);
    setTripDate(new Date(Date.now() + 60 * 60 * 1000));
    setTripModal(true);
  };

  const runTripSearch = async (text: string) => {
    if (text.length < 3) { setTripResults([]); return; }
    setTripSearching(true);
    try {
      setTripResults(await nominatimSearch(text));
    } catch {
      setTripResults([]);
    } finally {
      setTripSearching(false);
    }
  };

  const handleTripSearchChange = (text: string) => {
    setTripSearch(text);
    setTripDest(null);
    if (tripTimer.current) clearTimeout(tripTimer.current);
    tripTimer.current = setTimeout(() => runTripSearch(text), 500);
  };

  const savePlannedTrip = async () => {
    if (!deviceId || !tripDest) return;
    setTripSaving(true);
    try {
      const created = await createPlannedTrip(deviceId, {
        savedPlaceId: tripDest.savedPlaceId ?? null,
        label: tripDest.label,
        destLat: tripDest.lat,
        destLng: tripDest.lng,
        plannedAt: tripDate.getTime(),
      });
      setTrips((prev) => [...prev, created].sort((a, b) => a.plannedAt - b.plannedAt));
      setTripModal(false);
      Keyboard.dismiss();
    } catch {
      Alert.alert("Couldn't save trip", "Please check your connection and try again.");
    } finally {
      setTripSaving(false);
    }
  };

  const cancelTrip = (t: PlannedTrip) => {
    Alert.alert("Cancel Trip", `Cancel your trip to "${t.label}"?`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel Trip",
        style: "destructive",
        onPress: async () => {
          if (!deviceId) return;
          setTrips((prev) => prev.filter((x) => x.id !== t.id));
          try {
            await deletePlannedTrip(deviceId, t.id);
          } catch {
            load();
          }
        },
      },
    ]);
  };

  // ── History (past) helpers ──────────────────────────────────────────────

  const totalDist = tripHistory.reduce((s, t) => s + t.distance, 0);
  const totalTrips = tripHistory.length;
  const totalAlerts = tripHistory.reduce((s, t) => s + t.alertsCount, 0);

  const onClearHistory = () => {
    Alert.alert("Clear History", "Remove all saved trips? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: clearTripHistory },
    ]);
  };

  const upcomingTrips = trips.filter((t) => t.status === "upcoming" || t.status === "notified");

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <Text style={[styles.title, { color: c.foreground }]}>Trips</Text>

        <View style={[styles.segment, { backgroundColor: c.muted }]}>
          {(["share", "planned", "past"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.segmentBtn, tab === t && { backgroundColor: c.card }]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.segmentText, { color: tab === t ? c.primary : c.mutedForeground }]}>
                {t === "share" ? "Share" : t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === "share" ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 100, paddingTop: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Live status banner */}
          {isSharingTrip && (
            <View style={[styles.liveCard, { backgroundColor: "#00C85318", borderColor: "#00C85355" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <View style={styles.liveDot} />
                <Text style={styles.liveTxt}>Your location is live</Text>
              </View>
              <Text style={[styles.liveLink, { color: c.mutedForeground }]} numberOfLines={1}>{shareLink}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  style={[styles.liveAction, { backgroundColor: "#00C853", flex: 1 }]}
                  onPress={async () => {
                    if (shareLink) await Share.share({ message: `Follow my live trip 📍\n${shareLink}`, url: shareLink });
                  }}
                >
                  <Ionicons name="share-outline" size={15} color="#fff" />
                  <Text style={styles.liveActionTxt}>Share link again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.liveAction, { backgroundColor: c.muted, flex: 1 }]}
                  onPress={() => stopSharingTrip()}
                >
                  <Ionicons name="stop-circle-outline" size={15} color={c.foreground} />
                  <Text style={[styles.liveActionTxt, { color: c.foreground }]}>Stop sharing</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Hero */}
          <View style={[styles.shareHero, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.shareHeroIcon, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name="radio-outline" size={36} color={c.primary} />
            </View>
            <Text style={[styles.shareHeroTitle, { color: c.foreground }]}>Share Your Live Location</Text>
            <Text style={[styles.shareHeroSub, { color: c.mutedForeground }]}>
              Let anyone track your trip in real time — no app needed. They just open your link in any browser.
            </Text>
          </View>

          {/* CTA */}
          {!isSharingTrip && (
            navigationActive ? (
              <TouchableOpacity
                style={[styles.shareHeroCta, { backgroundColor: c.primary }]}
                onPress={handleSharePress}
                disabled={sharingLoading}
                activeOpacity={0.85}
              >
                {sharingLoading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="share-social" size={19} color="#fff" />
                    <Text style={styles.shareHeroCtaTxt}>Share Trip Now</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <View style={[styles.shareHeroNotice, { backgroundColor: c.muted }]}>
                <Ionicons name="navigate-outline" size={18} color={c.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.shareHeroNoticeTitle, { color: c.foreground }]}>Start navigation first</Text>
                  <Text style={[styles.shareHeroNoticeSub, { color: c.mutedForeground }]}>
                    Go to the Drive tab, enter a destination, and tap Start. The Share Trip button will appear.
                  </Text>
                </View>
              </View>
            )
          )}

          {/* How it works */}
          <Text style={[styles.shareSection, { color: c.foreground }]}>How it works</Text>
          {[
            {
              icon: "navigate-circle-outline" as const,
              title: "Start navigation",
              body: "Go to the Drive tab and enter your destination. Tap Start when you are ready.",
            },
            {
              icon: "radio-outline" as const,
              title: 'Tap "Share Trip"',
              body: "A Share Trip button appears at the bottom of the screen while you're driving. Tap it once.",
            },
            {
              icon: "link-outline" as const,
              title: "Send the link",
              body: "Share via WhatsApp, SMS, or any app. Anyone can open it on any phone or computer — no app needed.",
            },
          ].map((s) => (
            <View key={s.title} style={[styles.stepRow, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={[styles.stepIcon, { backgroundColor: c.primary + "18" }]}>
                <Ionicons name={s.icon} size={22} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepTitle, { color: c.foreground }]}>{s.title}</Text>
                <Text style={[styles.stepBody, { color: c.mutedForeground }]}>{s.body}</Text>
              </View>
            </View>
          ))}

          {/* Who uses this */}
          <Text style={[styles.shareSection, { color: c.foreground, marginTop: 8 }]}>Who uses this</Text>
          <View style={styles.useCaseGrid}>
            {[
              {
                icon: "people-outline" as const,
                title: "Family tracking",
                body: "Know when your husband, wife, or child is safely on their way or has arrived.",
              },
              {
                icon: "bicycle-outline" as const,
                title: "Delivery drivers",
                body: "Customers see your exact ETA without calling. Fewer missed deliveries.",
              },
              {
                icon: "business-outline" as const,
                title: "Company vehicles",
                body: "Operations teams track the fleet in real time from any device.",
              },
              {
                icon: "moon-outline" as const,
                title: "Night safety",
                body: "Driving late? Share your location so someone knows you're safe.",
              },
            ].map((u) => (
              <View key={u.title} style={[styles.useCaseCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Ionicons name={u.icon} size={24} color={c.primary} />
                <Text style={[styles.useCaseTitle, { color: c.foreground }]}>{u.title}</Text>
                <Text style={[styles.useCaseBody, { color: c.mutedForeground }]}>{u.body}</Text>
              </View>
            ))}
          </View>

          {/* Privacy note */}
          <View style={[styles.privacyNote, { backgroundColor: c.muted, borderColor: c.border }]}>
            <Ionicons name="lock-closed-outline" size={14} color={c.mutedForeground} style={{ marginTop: 1 }} />
            <Text style={[styles.privacyText, { color: c.mutedForeground }]}>
              Sharing stops automatically when you end navigation or after 8 hours. Only people with your link can see your location — it is never public.
            </Text>
          </View>
        </ScrollView>
      ) : tab === "planned" ? (
        <FlatList
          {...FLAT_LIST_PROPS}
          data={upcomingTrips}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingBottom: bottomInset + 100 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Saved places */}
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, { color: c.foreground }]}>Saved Places</Text>
                <TouchableOpacity onPress={openAddPlace} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="add-circle" size={24} color={c.primary} />
                </TouchableOpacity>
              </View>

              {loading ? (
                <ActivityIndicator style={{ marginVertical: 20 }} color={c.primary} />
              ) : places.length === 0 ? (
                <TouchableOpacity
                  style={[styles.emptyInline, { borderColor: c.border }]}
                  onPress={openAddPlace}
                >
                  <Ionicons name="add" size={18} color={c.mutedForeground} />
                  <Text style={[styles.emptyInlineText, { color: c.mutedForeground }]}>
                    Add Home, Work, or another place
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 8 }}>
                  {places.map((p) => (
                    <View key={p.id} style={[styles.placeRow, { backgroundColor: c.card, borderColor: c.border }]}>
                      <View style={[styles.placeIconWrap, { backgroundColor: c.primary + "18" }]}>
                        <Ionicons name={placeIcon(p.kind)} size={18} color={c.primary} />
                      </View>
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => setRouteCheck({ label: p.label, lat: p.lat, lng: p.lng })}
                      >
                        <Text style={[styles.placeLabel, { color: c.foreground }]}>{p.label}</Text>
                        {!!p.address && (
                          <Text style={[styles.placeAddr, { color: c.mutedForeground }]} numberOfLines={1}>
                            {p.address}
                          </Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openPlanTrip(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 14 }}>
                        <Ionicons name="calendar-outline" size={17} color={c.mutedForeground} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openEditPlace(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 14 }}>
                        <Ionicons name="pencil-outline" size={17} color={c.mutedForeground} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removePlace(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="trash-outline" size={17} color={c.speedDanger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Plan a trip button */}
              <TouchableOpacity
                style={[styles.planBtn, { backgroundColor: c.primary }]}
                onPress={() => openPlanTrip()}
              >
                <Ionicons name="calendar-outline" size={18} color="#FFF" />
                <Text style={styles.planBtnText}>Plan a Trip</Text>
              </TouchableOpacity>

              <Text style={[styles.sectionTitle, { color: c.foreground, marginTop: 22, marginBottom: 4 }]}>
                Upcoming
              </Text>
            </>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tripRow, { backgroundColor: c.card, borderColor: c.border }]}
              activeOpacity={0.75}
              onPress={() => setRouteCheck({ label: item.label, lat: item.destLat, lng: item.destLng })}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.tripLabel, { color: c.foreground }]}>{item.label}</Text>
                <Text style={[styles.tripTime, { color: c.mutedForeground }]}>{tripDateStr(item.plannedAt)}</Text>
                {item.status === "notified" && (
                  <View style={[styles.notifiedBadge, { backgroundColor: c.primary + "18" }]}>
                    <Ionicons name="notifications" size={11} color={c.primary} />
                    <Text style={[styles.notifiedText, { color: c.primary }]}>Advice sent</Text>
                  </View>
                )}
              </View>
              <View style={styles.tripRowActions}>
                <Ionicons name="shield-checkmark-outline" size={17} color={c.mutedForeground} style={{ marginRight: 12 }} />
                <TouchableOpacity onPress={() => cancelTrip(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle-outline" size={22} color={c.mutedForeground} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={44} color={c.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: c.foreground }]}>No trips planned</Text>
                <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                  Plan a trip and we'll tell you the best time to leave.
                </Text>
              </View>
            ) : null
          }
        />
      ) : (
        <FlatList
          {...FLAT_LIST_PROPS}
          data={tripHistory}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: bottomInset + 100 }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={tripHistory.length > 0}
          ListHeaderComponent={
            <>
              {tripHistory.length > 0 && (
                <View style={styles.summaryRow}>
                  <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[styles.summaryVal, { color: c.primary }]}>{totalTrips}</Text>
                    <Text style={[styles.summaryLbl, { color: c.mutedForeground }]}>Trips</Text>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[styles.summaryVal, { color: c.primary }]}>{distStr(totalDist)}</Text>
                    <Text style={[styles.summaryLbl, { color: c.mutedForeground }]}>Total</Text>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[styles.summaryVal, { color: totalAlerts > 0 ? c.speedDanger : c.primary }]}>
                      {totalAlerts}
                    </Text>
                    <Text style={[styles.summaryLbl, { color: c.mutedForeground }]}>Alerts</Text>
                  </View>
                  <TouchableOpacity onPress={onClearHistory} style={styles.clearBtn}>
                    <Ionicons name="trash-outline" size={18} color={c.mutedForeground} />
                  </TouchableOpacity>
                </View>
              )}
              {currentTrip && (
                <View style={[styles.activeTrip, { backgroundColor: c.primary + "18", borderColor: c.primary + "44" }]}>
                  <View style={[styles.activeDot, { backgroundColor: c.speedSafe }]} />
                  <Text style={[styles.activeTripText, { color: c.primary }]}>
                    Trip in progress — {distStr(currentTrip.distance ?? 0)} · {Math.round(currentTrip.avgSpeed ?? 0)} km/h avg
                  </Text>
                </View>
              )}
            </>
          }
          renderItem={({ item }) => <TripCard trip={item} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="car-outline" size={52} color={c.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: c.foreground }]}>No trips yet</Text>
              <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                Start driving and your trips will appear here automatically.
              </Text>
            </View>
          }
        />
      )}

      {/* ── Add/Edit Saved Place modal ── */}
      <Modal visible={placeModal} animationType="slide" transparent onRequestClose={() => setPlaceModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? topInset : 0}
        >
          <View style={[styles.modalCard, { backgroundColor: c.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.foreground }]}>
                {editingPlace ? "Edit Saved Place" : "Add Saved Place"}
              </Text>
              <TouchableOpacity onPress={() => setPlaceModal(false)}>
                <Ionicons name="close" size={24} color={c.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: bottomInset + 20 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Name</Text>
              <TextInput
                style={[styles.input, { color: c.foreground, borderColor: c.border, backgroundColor: c.background }]}
                placeholder="e.g. Home, Office, Mum's house"
                placeholderTextColor={c.mutedForeground}
                value={placeLabel}
                onChangeText={setPlaceLabel}
              />

              <View style={styles.kindRow}>
                {(["home", "work", "custom"] as const).map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={[styles.kindChip, { borderColor: placeKind === k ? c.primary : c.border, backgroundColor: placeKind === k ? c.primary + "18" : "transparent" }]}
                    onPress={() => setPlaceKind(k)}
                  >
                    <Ionicons name={placeIcon(k)} size={14} color={placeKind === k ? c.primary : c.mutedForeground} />
                    <Text style={[styles.kindChipText, { color: placeKind === k ? c.primary : c.mutedForeground }]}>
                      {k === "custom" ? "Other" : k.charAt(0).toUpperCase() + k.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: c.mutedForeground, marginTop: 14 }]}>Location</Text>
              <TextInput
                style={[styles.input, { color: c.foreground, borderColor: c.border, backgroundColor: c.background }]}
                placeholder="Search for an address…"
                placeholderTextColor={c.mutedForeground}
                value={placeSearch}
                onChangeText={handlePlaceSearchChange}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {placeSearching && <ActivityIndicator style={{ marginTop: 8 }} color={c.primary} />}
              {!placeSelected && placeResults.length > 0 && (
                <View style={[styles.resultsBox, { borderColor: c.border }]}>
                  {placeResults.map((r, idx) => (
                    <TouchableOpacity
                      key={`${r.lat}-${r.lng}-${idx}`}
                      style={styles.resultRow}
                      onPress={() => {
                        setPlaceSelected(r);
                        setPlaceSearch(r.short);
                        setPlaceResults([]);
                        Keyboard.dismiss();
                      }}
                    >
                      <Ionicons name="location-outline" size={15} color={c.mutedForeground} />
                      <Text style={[styles.resultText, { color: c.foreground }]} numberOfLines={1}>{r.display}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: c.primary, opacity: placeLabel.trim() && placeSelected && !placeSaving ? 1 : 0.5 }]}
                onPress={savePlace}
                disabled={!placeLabel.trim() || !placeSelected || placeSaving}
              >
                {placeSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Plan a Trip modal ── */}
      <Modal visible={tripModal} animationType="slide" transparent onRequestClose={() => setTripModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? topInset : 0}
        >
          <View style={[styles.modalCard, { backgroundColor: c.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.foreground }]}>Plan a Trip</Text>
              <TouchableOpacity onPress={() => setTripModal(false)}>
                <Ionicons name="close" size={24} color={c.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: bottomInset + 20 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Destination</Text>
              <TextInput
                style={[styles.input, { color: c.foreground, borderColor: c.border, backgroundColor: c.background }]}
                placeholder="Search or pick a saved place"
                placeholderTextColor={c.mutedForeground}
                value={tripSearch}
                onChangeText={handleTripSearchChange}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {tripSearching && <ActivityIndicator style={{ marginTop: 8 }} color={c.primary} />}
              {!tripDest && tripResults.length > 0 && (
                <View style={[styles.resultsBox, { borderColor: c.border }]}>
                  {tripResults.map((r, idx) => (
                    <TouchableOpacity
                      key={`${r.lat}-${r.lng}-${idx}`}
                      style={styles.resultRow}
                      onPress={() => {
                        setTripDest({ label: r.short, lat: r.lat, lng: r.lng });
                        setTripSearch(r.short);
                        setTripResults([]);
                        Keyboard.dismiss();
                      }}
                    >
                      <Ionicons name="location-outline" size={15} color={c.mutedForeground} />
                      <Text style={[styles.resultText, { color: c.foreground }]} numberOfLines={1}>{r.display}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {!tripDest && places.length > 0 && tripSearch.length === 0 && (
                <View style={{ marginTop: 10, gap: 6 }}>
                  {places.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.savedPickRow}
                      onPress={() => {
                        setTripDest({ label: p.label, lat: p.lat, lng: p.lng, savedPlaceId: p.id });
                        setTripSearch(p.label);
                      }}
                    >
                      <Ionicons name={placeIcon(p.kind)} size={15} color={c.primary} />
                      <Text style={[styles.resultText, { color: c.foreground }]}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.fieldLabel, { color: c.mutedForeground, marginTop: 14 }]}>Departure</Text>
              <View style={styles.dateRow}>
                <TouchableOpacity
                  style={[styles.dateBtn, { borderColor: c.border, backgroundColor: c.background }]}
                  onPress={() => setShowPicker("date")}
                >
                  <Ionicons name="calendar-outline" size={15} color={c.mutedForeground} />
                  <Text style={[styles.dateBtnText, { color: c.foreground }]}>
                    {tripDate.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dateBtn, { borderColor: c.border, backgroundColor: c.background }]}
                  onPress={() => setShowPicker("time")}
                >
                  <Ionicons name="time-outline" size={15} color={c.mutedForeground} />
                  <Text style={[styles.dateBtnText, { color: c.foreground }]}>
                    {tripDate.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" })}
                  </Text>
                </TouchableOpacity>
              </View>

              {showPicker && (
                <DateTimePicker
                  value={tripDate}
                  mode={showPicker}
                  is24Hour={false}
                  minimumDate={new Date()}
                  onChange={(_, selected) => {
                    if (Platform.OS === "android") setShowPicker(null);
                    if (!selected) return;
                    const next = new Date(tripDate);
                    if (showPicker === "date") {
                      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
                    } else {
                      next.setHours(selected.getHours(), selected.getMinutes());
                      setShowPicker(null);
                    }
                    setTripDate(next);
                  }}
                />
              )}

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: c.primary, opacity: tripDest && !tripSaving ? 1 : 0.5 }]}
                onPress={savePlannedTrip}
                disabled={!tripDest || tripSaving}
              >
                {tripSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Save Trip</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {routeCheck && (
        <RouteCheckModal
          visible={!!routeCheck}
          onClose={() => setRouteCheck(null)}
          destLabel={routeCheck.label}
          destLat={routeCheck.lat}
          destLng={routeCheck.lng}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 14 },
  segment: { flexDirection: "row", borderRadius: 12, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segmentText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  sectionHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, marginBottom: 10, marginTop: 4,
  },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  emptyInline: {
    marginHorizontal: 16, borderWidth: 1, borderStyle: "dashed", borderRadius: 12,
    paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginBottom: 8,
  },
  emptyInlineText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  placeRow: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  placeIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  placeLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  placeAddr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  planBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginHorizontal: 16, borderRadius: 14, paddingVertical: 14, marginTop: 16,
  },
  planBtnText: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold" },

  tripRow: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 10,
  },
  tripRowActions: { flexDirection: "row", alignItems: "center" },
  tripLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tripTime: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  notifiedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginTop: 6,
  },
  notifiedText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 12, paddingHorizontal: 16, alignItems: "center" },
  summaryCard: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  summaryVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLbl: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  clearBtn: { padding: 6 },

  activeTrip: {
    flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 16, marginBottom: 12,
  },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  activeTripText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },

  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  modalOverlay: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, maxHeight: "88%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  kindRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  kindChip: {
    flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  kindChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  resultsBox: { borderWidth: 1, borderRadius: 12, marginTop: 8, overflow: "hidden" },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  resultText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  savedPickRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  dateRow: { flexDirection: "row", gap: 10 },
  dateBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  dateBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  saveBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  saveBtnText: { color: "#FFF", fontSize: 15, fontFamily: "Inter_700Bold" },

  // ── Share tab ────────────────────────────────────────────────────────────────
  liveCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#00C853" },
  liveTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#00C853", flex: 1 },
  liveLink: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },
  liveAction: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10, borderRadius: 10,
  },
  liveActionTxt: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  shareHero: {
    alignItems: "center", padding: 24, borderRadius: 20, borderWidth: 1, marginBottom: 14,
  },
  shareHeroIcon: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  shareHeroTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 8 },
  shareHeroSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  shareHeroCta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 16, paddingVertical: 16, marginBottom: 20,
  },
  shareHeroCtaTxt: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  shareHeroNotice: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    borderRadius: 14, padding: 14, marginBottom: 20,
  },
  shareHeroNoticeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  shareHeroNoticeSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  shareSection: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10, marginTop: 4 },

  stepRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 14,
    borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10,
  },
  stepIcon: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  stepTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  stepBody: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  useCaseGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  useCaseCard: { width: "48%", padding: 14, borderRadius: 14, borderWidth: 1, gap: 6 },
  useCaseTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  useCaseBody: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },

  privacyNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8,
  },
  privacyText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
});
