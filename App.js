import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import AppNavigator from "./src/navigation/AppNavigator";
import { navigationRef } from "./src/navigation/navigationRef";
import UpdateGate from "./src/components/UpdateGate";
import { ThemeProvider } from "./src/theme/ThemeProvider";
export default function App() {
  return (
    <UpdateGate>
      <ThemeProvider>
        <NavigationContainer ref={navigationRef}>
          <AppNavigator />
        </NavigationContainer>
      </ThemeProvider>
    </UpdateGate>
  );
}
