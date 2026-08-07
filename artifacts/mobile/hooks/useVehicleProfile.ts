/**
 * useVehicleProfile — persists the user's selected car make, model, and plate
 * in AsyncStorage. Kept separate from AppContext to stay lightweight and avoid
 * re-rendering the entire context tree on changes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";

export interface VehicleProfile {
  carMakeId: string | null;    // Imagin.Studio make slug, e.g. "toyota"
  carMakeName: string | null;  // Display name, e.g. "Toyota"
  carModelId: string | null;   // Imagin.Studio model slug, e.g. "rav-4"
  carModelName: string | null; // Display name, e.g. "RAV4"
  plateNumber: string | null;  // e.g. "KDD 123A"
}

const EMPTY: VehicleProfile = {
  carMakeId: null, carMakeName: null,
  carModelId: null, carModelName: null,
  plateNumber: null,
};

const K = {
  makeId:    "@msafiri/car_make_id",
  makeName:  "@msafiri/car_make_name",
  modelId:   "@msafiri/car_model_id",
  modelName: "@msafiri/car_model_name",
  plate:     "@msafiri/plate_number",
};

async function loadProfile(): Promise<VehicleProfile> {
  const [makeId, makeName, modelId, modelName, plate] = await Promise.all([
    AsyncStorage.getItem(K.makeId),
    AsyncStorage.getItem(K.makeName),
    AsyncStorage.getItem(K.modelId),
    AsyncStorage.getItem(K.modelName),
    AsyncStorage.getItem(K.plate),
  ]);
  return {
    carMakeId:   makeId   || null,
    carMakeName: makeName || null,
    carModelId:  modelId  || null,
    carModelName: modelName || null,
    plateNumber: plate    || null,
  };
}

export function useVehicleProfile() {
  const [profile, setProfile] = useState<VehicleProfile>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  // Re-read from storage whenever the screen comes into focus so that changes
  // made in the vehicle-setup screen are immediately visible in the garage.
  useFocusEffect(
    useCallback(() => {
      loadProfile().then((p) => {
        setProfile(p);
        setLoaded(true);
      }).catch(() => setLoaded(true));
    }, []),
  );

  const saveVehicle = useCallback(async (data: VehicleProfile) => {
    await Promise.all([
      AsyncStorage.setItem(K.makeId,    data.carMakeId    ?? ""),
      AsyncStorage.setItem(K.makeName,  data.carMakeName  ?? ""),
      AsyncStorage.setItem(K.modelId,   data.carModelId   ?? ""),
      AsyncStorage.setItem(K.modelName, data.carModelName ?? ""),
      AsyncStorage.setItem(K.plate,     data.plateNumber  ?? ""),
    ]);
    setProfile(data);
  }, []);

  const clearVehicle = useCallback(async () => {
    await Promise.all(Object.values(K).map((k) => AsyncStorage.removeItem(k)));
    setProfile(EMPTY);
  }, []);

  return { profile, loaded, saveVehicle, clearVehicle };
}
