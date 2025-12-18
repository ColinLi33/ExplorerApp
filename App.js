import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import HomeScreen from './src/components/HomeScreen';
import Registration from './src/components/Registration';
import MapScreen from './src/components/MapScreen';

const Stack = createStackNavigator();

const App = () => {
    return (
        <NavigationContainer>
            <Stack.Navigator initialRouteName="Home">
                <Stack.Screen 
                    name="Explorer" 
                    component={HomeScreen}
                    options={{ headerShown: false }}
                />
                <Stack.Screen 
                    name="Registration" 
                    component={Registration}
                    options={{ headerShown: false }}
                />
                <Stack.Screen 
                    name="Map" 
                    component={MapScreen}
                    options={{ headerShown: false, gestureEnabled: false }}
                />
            </Stack.Navigator>
        </NavigationContainer>
    );
};

export default App;