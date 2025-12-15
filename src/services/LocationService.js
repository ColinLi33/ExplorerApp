import BackgroundGeolocation from "react-native-background-geolocation";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { baseURL, fetchWithTimeout } from './ApiService';


// Track subscriptions for cleanup
let locationSubscription = null;
let motionChangeSubscription = null;
let activityChangeSubscription = null;
let providerChangeSubscription = null;

/**
 * Starts background GPS tracking with a balance of accuracy and battery efficiency.
 * Uses elastic distanceFilter that auto-adjusts based on speed.
 * Continues tracking in background and after app termination.
 */
export async function startLocationTracking() {
    try {
        const username = await AsyncStorage.getItem('username');
        const token = await AsyncStorage.getItem('accessToken');

        if (!username || !token) {
            console.log('Missing username or token, cannot start tracking');
            return;
        }



        // Wire up event listeners BEFORE calling ready()
        
        // Location updates - main event for GPS data
        locationSubscription = BackgroundGeolocation.onLocation(
            async (location) => {
                // Skip "sample" locations that are just intermediary updates
                if (location.sample) {
                    console.log('[location] Sample received (skipped)');
                    return;
                }

                console.log(`[location] lat=${location.coords.latitude.toFixed(5)}, lng=${location.coords.longitude.toFixed(5)}, accuracy=${location.coords.accuracy?.toFixed(1)}m`);

                // Send location to server
                const locationData = {
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    timestamp: Date.now(),
                };

                await sendLocationDataWithRetry({ username, location: locationData }, token);
            },
            (error) => {
                console.log('[location] ERROR:', error);
            }
        );

        // Motion state changes (moving <-> stationary)
        motionChangeSubscription = BackgroundGeolocation.onMotionChange((event) => {
            console.log(`[motionchange] isMoving=${event.isMoving}`);
        });

        // Activity type changes (walking, driving, etc.)
        activityChangeSubscription = BackgroundGeolocation.onActivityChange((event) => {
            console.log(`[activity] type=${event.activity}, confidence=${event.confidence}%`);
        });

        // Provider state changes (GPS enabled/disabled)
        providerChangeSubscription = BackgroundGeolocation.onProviderChange((event) => {
            console.log(`[provider] enabled=${event.enabled}, status=${event.status}`);
        });

        // Configure and start the plugin
        const state = await BackgroundGeolocation.ready({
            // Geolocation Settings
            desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH, // GPS accuracy for map display
            distanceFilter: 10, // Base distance filter in meters (auto-scales with speed)
            stationaryRadius: 25, // Radius to trigger stationary mode
            
            // Activity Recognition
            stopTimeout: 3, // Minutes to wait before switching to stationary after stillness
            isMoving: true, // Start in moving mode to get immediate location
            
            // Application Settings
            stopOnTerminate: false, // Continue tracking after app is terminated
            startOnBoot: true, // Resume tracking after device reboot
            enableHeadless: true, // Allow headless operation on Android
            showBackgroundLocationIndicator: false, // Show background location indicator
            
            // Logging (set to error for production, verbose for debugging)
            debug: false, // Disable debug sounds
            logLevel: BackgroundGeolocation.LOG_LEVEL_OFF,
        });


        console.log('[ready] BackgroundGeolocation state:', state);

        // Start tracking if not already enabled
        if (!state.enabled) {
            await BackgroundGeolocation.start();

            console.log('[start] Tracking started');
        }

        // Get current position to have an immediate update
        try {
            const currentPos = await BackgroundGeolocation.getCurrentPosition({
                timeout: 30,
                maximumAge: 5000,
                desiredAccuracy: 10,
                samples: 3,
            });
            console.log('[getCurrentPosition] Initial position:', currentPos.coords);
        } catch (err) {
            console.log('[getCurrentPosition] Error getting initial position:', err);
        }

        // Send any queued locations from previous sessions
        sendSavedLocationData(username);

    } catch (error) {
        console.error('Error starting location tracking:', error);

    }
}

/**
 * Stops background GPS tracking and cleans up event listeners.
 */
export async function stopLocationTracking() {
    try {


        // Remove all event subscriptions
        if (locationSubscription) {
            locationSubscription.remove();
            locationSubscription = null;
        }
        if (motionChangeSubscription) {
            motionChangeSubscription.remove();
            motionChangeSubscription = null;
        }
        if (activityChangeSubscription) {
            activityChangeSubscription.remove();
            activityChangeSubscription = null;
        }
        if (providerChangeSubscription) {
            providerChangeSubscription.remove();
            providerChangeSubscription = null;
        }

        // Stop the plugin
        await BackgroundGeolocation.stop();

        console.log('[stop] Tracking stopped');

    } catch (error) {
        console.error('Error stopping location tracking:', error);

    }
}

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
        console.log('Location sent OK');
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

async function sendSavedLocationData(username) {
    try {
        const savedData = await AsyncStorage.getItem('locationData');
        if (savedData) {
            const locationDataArray = JSON.parse(savedData);
            const token = await AsyncStorage.getItem('accessToken');
            
            if (!token) {
                 console.log('No token for sending saved data');
                 return false;
            }

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