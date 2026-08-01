/**
 * CrosshairPicker.tsx — web stub
 * The crosshair map picker is native-only (react-native-maps). The report
 * modal hides the "Drop Pin" mode on web, so this stub renders nothing.
 */
import React from "react";

export interface CrosshairMapProps {
  initialLat: number;
  initialLng: number;
  onCoordinateChange: (lat: number, lng: number) => void;
  initialDelta?: number;
  pinColor?: string;
}

export function CrosshairMap(_props: CrosshairMapProps) {
  return null;
}

export interface CrosshairPickerModalProps {
  visible: boolean;
  initialLat: number;
  initialLng: number;
  title?: string;
  hint?: string;
  onCancel: () => void;
  onConfirm: (lat: number, lng: number) => void;
}

export function CrosshairPickerModal(_props: CrosshairPickerModalProps) {
  return null;
}
