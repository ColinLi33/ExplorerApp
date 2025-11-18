import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { baseURL, fetchWithTimeout } from './ApiService';
import { getDistanceFromLatLonInM } from '../utils/GeoUtils';

const LOCATION_TRACKING = 'location-tracking';
const UPDATE_INTERVAL = 10000; // Fixed 10 second interval
const STATIONARY_THRESHOLD = 10; // meters
const STATIONARY_LIMIT = 5; // After 5 stationary checks (50s), switch to slow mode
const SLOW_MODE_SKIP_COUNT = 5; // In slow mode, only process every 6th update (60s)

async function saveLocationDataToStorage(data) {
    try {
        const existingData = await AsyncStorage.getItem('locationData');
        const locationDataArray = existingData ? JSON.parse(existingData) : [];
        locationDataArray.push(data);
        console.log('queued location');
        await AsyncStorage.setItem('locationData', JSON.stringify(locationDataArray));
        DeviceEventEmitter.emit('locationQueueUpdated', locationDataArray.length);
        return locationDataArray.length;
    } catch (error) {
        console.error('Error saving location data:', error);
        return 0;
    }
}

async function sendLocationDataWithRetry(data, token) {
    try {
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(data),
        };
        const response = await fetchWithTimeout(`${baseURL}/update`, options);
        if (!response.ok) throw new Error('Failed to update location');
        console.log('Location sent successfully');
        const currentTime = Date.now();
        DeviceEventEmitter.emit('lastUpdatedSet', currentTime);
        await AsyncStorage.setItem('lastUpdated', currentTime.toString());
        return response.json();
    } catch (error) {
        console.error('Location update error:', error);
        await saveLocationDataToStorage(data.location);
        return false;
    }
}

export async function sendSavedLocationData(username) {
    try {
        const savedData = await AsyncStorage.getItem('locationData');
        if (savedData) {
            const locationDataArray = JSON.parse(savedData);
            const token = await AsyncStorage.getItem('accessToken');
            for (let i = 0; i < locationDataArray.length; i+=10) {
                const batch = locationDataArray.slice(i, i + 10);
                const options = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ username, location: batch }),
                };
                const response = await fetchWithTimeout(`${baseURL}/update`, options);
                if(response.ok){
                    console.log(`Sent batch of ${batch.length} locations`);
                    locationDataArray.splice(i, batch.length);
                    i -= batch.length;
                    await AsyncStorage.setItem('locationData', JSON.stringify(locationDataArray));
                    DeviceEventEmitter.emit('locationQueueUpdated', locationDataArray.length);
                    const currentTime = Date.now();
                    DeviceEventEmitter.emit('lastUpdatedSet', currentTime);
                    await AsyncStorage.setItem('lastUpdated', currentTime.toString());
                } else {
                    console.error('Failed to send batch location data');
                    DeviceEventEmitter.emit('locationQueueUpdated', locationDataArray.length);
                    return false;
                }
            }
        }
        return true;
    } catch (error) {
        console.error('Error sending saved location data:', error);
        return false;
    }
}

export const startLocationTracking = async () => {
    let { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
        console.log('Foreground location permission denied');
        return;
    }

    let { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
        console.log('Background location permission denied');
        return;
    }
    
    try {
        const isStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING);
        if (isStarted) {
             await Location.stopLocationUpdatesAsync(LOCATION_TRACKING);
        }

        await Location.startLocationUpdatesAsync(LOCATION_TRACKING, {
            accuracy: Location.Accuracy.Highest,
            timeInterval: UPDATE_INTERVAL,
            distanceInterval: 0,
            showsBackgroundLocationIndicator: false,
            foregroundService: {
                notificationTitle: "Explorer",
                notificationBody: `Tracking your location`,
                notificationColor: "#ff0000",
            },
            pausesUpdatesAutomatically: false,
            killServiceOnDestroy: false,
        });
        console.log(`location tracking started with interval ${UPDATE_INTERVAL}ms`);
        
        // Reset tracking state
        await AsyncStorage.setItem('trackingMode', 'FAST');
        await AsyncStorage.setItem('stationaryCount', '0');
        await AsyncStorage.setItem('slowModeSkipCounter', '0');
        await AsyncStorage.removeItem('lastLocation');

    } catch (error) {
        console.error('Failed to start location tracking:', error);
    }
};

export const stopLocationTracking = async () => {
    const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING);
    if (isTracking) {
        await Location.stopLocationUpdatesAsync(LOCATION_TRACKING);
        console.log('Location tracking stopped');
    } 
};

TaskManager.defineTask(LOCATION_TRACKING, async ({ data, error }) => {
    if (error) {
        console.log('LOCATION_TRACKING task ERROR:', error);
        return;
    }
    const locations = data?.locations;
    if (!locations || locations.length === 0) {
        console.log('No locations received in background.');
        return;
    }
    const latest = locations.length > 1 ? locations[locations.length - 1] : locations[0];
    console.log('Background location received:', latest);

    try {
        const currentMode = await AsyncStorage.getItem('trackingMode') || 'FAST';
        const lastLocationStr = await AsyncStorage.getItem('lastLocation');
        let stationaryCount = parseInt(await AsyncStorage.getItem('stationaryCount') || '0', 10);
        let slowModeSkipCounter = parseInt(await AsyncStorage.getItem('slowModeSkipCounter') || '0', 10);
        
        // If in SLOW mode, only process every Nth update to save battery
        if (currentMode === 'SLOW') {
            slowModeSkipCounter++;
            await AsyncStorage.setItem('slowModeSkipCounter', slowModeSkipCounter.toString());
            
            if (slowModeSkipCounter < SLOW_MODE_SKIP_COUNT) {
                console.log(`SLOW mode: Skipping update ${slowModeSkipCounter}/${SLOW_MODE_SKIP_COUNT}`);
                return; // Skip processing this update
            }
            // Reset counter after processing
            slowModeSkipCounter = 0;
            await AsyncStorage.setItem('slowModeSkipCounter', '0');
        }
        
        // Check for movement
        let hasMoved = false;
        if (lastLocationStr) {
            const lastLocation = JSON.parse(lastLocationStr);
            const distance = getDistanceFromLatLonInM(
                lastLocation.coords.latitude,
                lastLocation.coords.longitude,
                latest.coords.latitude,
                latest.coords.longitude
            );
            
            console.log(`Distance moved: ${distance.toFixed(2)}m. Current Mode: ${currentMode}`);

            if (distance < STATIONARY_THRESHOLD) {
                stationaryCount++;
            } else {
                stationaryCount = 0;
                hasMoved = true;
            }
        }

        // Switch modes based on movement
        if (currentMode === 'FAST' && stationaryCount >= STATIONARY_LIMIT) {
            console.log('User is stationary. Switching to SLOW mode (throttling updates).');
            await AsyncStorage.setItem('trackingMode', 'SLOW');
            await AsyncStorage.setItem('slowModeSkipCounter', '0');
            stationaryCount = 0;
        } else if (currentMode === 'SLOW' && hasMoved) {
            console.log('Movement detected! Switching to FAST mode.');
            await AsyncStorage.setItem('trackingMode', 'FAST');
            await AsyncStorage.setItem('slowModeSkipCounter', '0');
        }

        await AsyncStorage.setItem('lastLocation', JSON.stringify(latest));
        await AsyncStorage.setItem('stationaryCount', stationaryCount.toString());

        // Send location data
        const storedUsername = await AsyncStorage.getItem('username');
        const storedToken = await AsyncStorage.getItem('accessToken');
        
        if (!storedUsername || !storedToken) {
            console.log('No username or token available in background task');
            return;
        }

        const success = await sendLocationDataWithRetry({ username: storedUsername, location: latest }, storedToken);
        if (success) {
            await sendSavedLocationData(storedUsername);
        }
    } catch (e) {
        console.log('Error in background task handler:', e);
    }
});
