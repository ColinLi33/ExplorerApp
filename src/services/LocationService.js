import BackgroundGeolocation from "react-native-background-geolocation";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { baseURL } from './ApiService';

// Track subscriptions for cleanup
let locationSubscription = null;
let motionChangeSubscription = null;
let activityChangeSubscription = null;
let providerChangeSubscription = null;

export async function startLocationTracking() {
    try {
        const username = await AsyncStorage.getItem('username');
        const token = await AsyncStorage.getItem('accessToken');

        if (!username || !token) {
            console.log('Missing username or token, cannot start tracking');
            return;
        }
        //TODO: remove after testing
        locationSubscription = BackgroundGeolocation.onLocation(
            (location) => {
                if (location.sample) {
                    console.log('[location] Sample received (skipped)');
                    return;
                }
                console.log(`[location] lat=${location.coords.latitude.toFixed(5)}, lng=${location.coords.longitude.toFixed(5)}, accuracy=${location.coords.accuracy?.toFixed(1)}m`);
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

        // HTTP sync events (track when locations are synced to server)
        BackgroundGeolocation.onHttp((event) => {
            if (event.success) {
                console.log(`[http] Synced ${event.responseText}`);
            } else {
                console.log(`[http] Failed: ${event.status} - ${event.responseText}`);
            }
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
            
            // Permission Settings
            locationAuthorizationRequest: 'Always',
            backgroundPermissionRationale: {
                title: "Allow Background Location Access",
                message: "This app needs to access your location even when closed to accurately track and map your travel history. Please select 'Allow all the time' in the next screen.",
                positiveAction: "Settings",
                negativeAction: "Cancel"
            },
            activityRecognitionPermissionRationale: {
                title: "Allow Activity Recognition",
                message: "This app uses motion detection to turn off location tracking when you are stationary to save battery.",
                positiveAction: "OK",
                negativeAction: "Cancel"
            },
            
            // Application Settings
            stopOnTerminate: false, // Continue tracking after app is terminated
            startOnBoot: true, // Resume tracking after device reboot
            enableHeadless: true, // Allow headless operation on Android
            showsBackgroundLocationIndicator: false, // Show background location indicator
            locationAuthorizationAlert: {
                titleWhenNotEnabled: "Location services are not enabled",
                titleWhenOff: "Location services are off",
                instructions: "To track your travel history, you must enable 'Always' in location services.",
                cancelButton: "Cancel",
                settingsButton: "Settings"
            },
            
            // HTTP Sync - sends locations directly from native code (works when JS is suspended)
            url: `${baseURL}/update`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            params: {
                username: username,
                timestamp: Date.now()
            },
            httpRootProperty: 'location',
            autoSync: true,              
            autoSyncThreshold: 5,        
            batchSync: true,             
            maxBatchSize: 50,            
            
            debug: false,
            logLevel: BackgroundGeolocation.LOG_LEVEL_ERROR,
        });

        console.log('[ready] BackgroundGeolocation state:', state);
        if (!state.enabled) {
            await BackgroundGeolocation.start();
            console.log('[start] Tracking started');
        }
        try {
            const currentPos = await BackgroundGeolocation.getCurrentPosition({
                timeout: 30,
                maximumAge: 5000,
                desiredAccuracy: 10,
                samples: 1,
            });
            console.log('[getCurrentPosition] Initial position:', currentPos.coords);
        } catch (err) {
            console.log('[getCurrentPosition] Error getting initial position:', err);
        }
    } catch (error) {
        console.error('Error starting location tracking:', error);
    }
}

export async function stopLocationTracking() {
    try {
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
        await BackgroundGeolocation.stop();
        console.log('[stop] Tracking stopped');
    } catch (error) {
        console.error('Error stopping location tracking:', error);


    }
}