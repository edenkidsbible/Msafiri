import React from "react";
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";
import { Platform, ScrollView, ScrollViewProps } from "react-native";
import { SCROLL_PROPS } from "@/lib/scrollProps";

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export const KeyboardAwareScrollViewCompat = React.forwardRef<ScrollView, Props>(
  function KeyboardAwareScrollViewCompat(
    { children, keyboardShouldPersistTaps = "handled", ...props },
    ref,
  ) {
    if (Platform.OS === "web") {
      return (
        <ScrollView
          ref={ref}
          {...SCROLL_PROPS}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          {...props}
        >
          {children}
        </ScrollView>
      );
    }
    return (
      <KeyboardAwareScrollView
        ref={ref as any}
        {...SCROLL_PROPS}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </KeyboardAwareScrollView>
    );
  },
);
