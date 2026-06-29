import React, { useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { POIItem } from "@/components/POICard";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.12, longitudeDelta: 0.12 };

function distStr(m: number | undefined): string {
  if (m == null) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

// Colored circular icon marker — works on all Android versions (no emoji dependency)
function POIMarker({ type }: { type: "fuel" | "food" }) {
  const bg = type === "fuel" ? "#2E7D32" : "#BF360C";
  return (
    <View style={[styles.markerCircle, { backgroundColor: bg }]}>
      {type === "fuel" ? (
        <MaterialCommunityIcons name="gas-station" size={16} color="#FFF" />
      ) : (
        <Ionicons name="restaurant" size={15} color="#FFF" />
      )}
    </View>
  );
}

interface Props {
  pois: (POIItem & { distance?: number })[];
  tab: "fuel" | "food";
  userLat: number | null;
  userLng: number | null;
  onGo: (poi: POIItem) => void;
}

export default function BrowseMapView({ pois, tab, userLat, userLng, onGo }: Props) {
  const c = useColors();
  const mapRef = useRef<MapView>(null);
  const [selectedPOI, setSelectedPOI] = useState<(POIItem & { distance?: number }) | null>(null);

  const visiblePOIs = pois.filter((p) => p.type === tab);

  const centerOnUser = () => {
    if (mapRef.current && userLat && userLng) {
      mapRef.current.animateToRegion(
        { latitude: userLat, longitude: userLng, latitudeDelta: 0.06, longitudeDelta: 0.06 },
        600
      );
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={
          userLat && userLng
            ? { latitude: userLat, longitude: userLng, latitudeDelta: 0.08, longitudeDelta: 0.08 }
            : NAIROBI
        }
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
      >
        {visiblePOIs.map((poi) => (
          <Marker
            key={poi.id}
            coordinate={{ latitude: poi.lat, longitude: poi.lng }}
            anchor={{ x: 0.5, y: 1 }}
            onPress={() => setSelectedPOI(poi)}
            title={poi.name}
          >
            <POIMarker type={poi.type} />
          </Marker>
        ))}
      </MapView>

      {/* Locate-me button */}
      <TouchableOpacity
        style={[styles.locateBtn, { backgroundColor: c.card }]}
        onPress={centerOnUser}
      >
        <Ionicons name="locate-outline" size={22} color={c.primary} />
      </TouchableOpacity>

      {/* Result count badge */}
      <View style={[styles.countBadge, { backgroundColor: c.card + "EE" }]}>
        <Text style={[styles.countText, { color: c.foreground }]}>
          {visiblePOIs.length} {tab === "fuel" ? "fuel stations" : "restaurants"} nearby
        </Text>
      </View>

      {/* Selected POI bottom card */}
      {selectedPOI && (
        <View style={[styles.poiCard, { backgroundColor: c.card }]}>
          <TouchableOpacity
            style={styles.poiCardClose}
            onPress={() => setSelectedPOI(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={20} color={c.mutedForeground} />
          </TouchableOpacity>

          <View style={styles.poiCardRow}>
            <View style={[
              styles.poiCardIcon,
              { backgroundColor: selectedPOI.type === "fuel" ? "#2E7D3222" : "#BF360C22" },
            ]}>
              {selectedPOI.type === "fuel" ? (
                <MaterialCommunityIcons name="gas-station" size={24} color="#2E7D32" />
              ) : (
                <Ionicons name="restaurant" size={22} color="#BF360C" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.poiCardName, { color: c.foreground }]} numberOfLines={1}>
                {selectedPOI.name}
              </Text>
              {selectedPOI.address ? (
                <Text style={[styles.poiCardAddr, { color: c.mutedForeground }]} numberOfLines={1}>
                  {selectedPOI.address}
                </Text>
              ) : null}
              {selectedPOI.distance != null && (
                <Text style={[styles.poiCardDist, { color: c.primary }]}>
                  {distStr(selectedPOI.distance)} away
                </Text>
              )}
            </View>
          </View>

          {selectedPOI.hours ? (
            <View style={styles.hoursRow}>
              <Ionicons name="time-outline" size={13} color={c.mutedForeground} />
              <Text style={[styles.hoursText, { color: c.mutedForeground }]}>
                {selectedPOI.hours}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.goBtn, { backgroundColor: c.primary }]}
            onPress={() => { onGo(selectedPOI); setSelectedPOI(null); }}
            activeOpacity={0.86}
          >
            <Ionicons name="navigate" size={16} color={c.primaryForeground} />
            <Text style={[styles.goBtnText, { color: c.primaryForeground }]}>
              Navigate to {selectedPOI.name.split(" ")[0]}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  markerCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
    borderWidth: 2,
    borderColor: "#FFF",
  },
  locateBtn: {
    position: "absolute",
    right: 12,
    bottom: 180,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 6,
  },
  countBadge: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    left: "20%",
    right: "20%",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 5,
  },
  countText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  poiCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 30,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 14,
  },
  poiCardClose: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  poiCardRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 32 },
  poiCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  poiCardName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  poiCardAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  poiCardDist: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hoursText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  goBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
  goBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
