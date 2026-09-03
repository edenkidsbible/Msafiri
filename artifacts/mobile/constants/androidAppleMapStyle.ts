/**
 * Light Google Maps styling tuned toward Apple's restrained map presentation.
 *
 * This is Android-only: iOS uses native Apple Maps and ignores customMapStyle.
 * App-owned markers, routes, and overlays are unaffected by these base-map
 * rules.
 */
const ANDROID_APPLE_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#f5f7f6" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#68736f" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f7f6" }] },

  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#d9dfdc" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#59645f" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#4e5a55" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },

  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", elementType: "labels.text", stylers: [{ visibility: "off" }] },
  { featureType: "poi.attraction", elementType: "labels.text", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#dcefdc" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6f9274" }] },

  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e1e6e3" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#697570" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#fff2c9" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#eadfbf" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#ffffff" }] },

  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfe8f5" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#6d9eaf" }] },
];

export default ANDROID_APPLE_MAP_STYLE;