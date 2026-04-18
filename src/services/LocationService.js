import BackgroundGeolocation from "react-native-background-geolocation";
import BackgroundFetch from "react-native-background-fetch";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { baseURL } from './ApiService';
import { refreshAuthToken } from './AuthService';

// Track subscriptions for cleanup
let locationSubscription = null;
let motionChangeSubscription = null;
let activityChangeSubscription = null;
let providerChangeSubscription = null;
let httpSubscription = null;
let heartbeatSubscription = null;

/**
 * Refreshes the auth token and updates the BackgroundGeolocation plugin's
 * HTTP headers so that background syncs continue to authenticate successfully.
 * This is the key fix for iOS — without this, the native HTTP sync silently
 * fails after the JWT expires while the app is suspended.
 */
async function refreshPluginToken() {
    try {
        const newToken = await refreshAuthToken();
        if (newToken) {
            const username = await AsyncStorage.getItem('username');
            await BackgroundGeolocation.setConfig({
                headers: {
                    'Authorization': `Bearer ${newToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    username: username,
                    timestamp: Date.now(),
                },
            });
            console.log('[token] Refreshed plugin auth token');
            return true;
        } else {
            console.log('[token] Failed to refresh - no new token returned');
            return false;
        }
    } catch (error) {
        console.error('[token] Error refreshing plugin token:', error);
        return false;
    }
}

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

        // HTTP sync events — detect auth failures and auto-refresh token
        httpSubscription = BackgroundGeolocation.onHttp((event) => {
            if (event.success) {
                console.log(`[http] Synced ${event.responseText}`);
            } else {
                console.log(`[http] Failed: ${event.status} - ${event.responseText}`);
                // If we get a 401/403, the token has expired — refresh it
                if (event.status === 401 || event.status === 403) {
                    console.log('[http] Auth failure detected, refreshing token...');
                    refreshPluginToken();
                }
            }
        });

        // Heartbeat — fires periodically even when stationary.
        // Use this to refresh auth tokens so background HTTP sync never breaks.
        heartbeatSubscription = BackgroundGeolocation.onHeartbeat(async (event) => {
            console.log(`[heartbeat] ♥`);
            await refreshPluginToken();
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
            
            // Heartbeat — fires every 15 minutes even when stationary.
            // This keeps the plugin alive on iOS and lets us refresh the auth token.
            heartbeatInterval: 900, // 15 minutes (in seconds)
            preventSuspend: true, // iOS: prevent app suspension to maintain heartbeat
            
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
                timestamp: Date.now(),
            },
            httpRootProperty: 'location',
            autoSync: true,              
            autoSyncThreshold: 5,        
            batchSync: true,             
            maxBatchSize: 50,
            maxDaysToPersist: 14, // Keep unsent locations for up to 14 days
            
            debug: false,
            logLevel: BackgroundGeolocation.LOG_LEVEL_ERROR,
        });

        console.log('[ready] BackgroundGeolocation state:', state);
        if (!state.enabled) {
            await BackgroundGeolocation.start();
            console.log('[start] Tracking started');
        }

        // Configure BackgroundFetch — periodic wakeups on iOS (~every 15 min).
        // iOS decides the actual schedule based on user app-usage patterns.
        // This gives us a chance to refresh tokens even when the app is suspended.
        await initBackgroundFetch();

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

/**
 * Initialize BackgroundFetch for periodic iOS wakeups.
 * When iOS wakes the app, we refresh the auth token so that
 * the native HTTP sync continues to work indefinitely.
 */
async function initBackgroundFetch() {
    try {
        const fetchStatus = await BackgroundFetch.configure(
            {
                minimumFetchInterval: 15, // minutes (iOS minimum is 15)
                stopOnTerminate: false,
                startOnBoot: true,
                enableHeadless: true,
            },
            async (taskId) => {
                console.log('[BackgroundFetch] Event:', taskId);
                // Refresh the auth token on each wakeup
                await refreshPluginToken();
                BackgroundFetch.finish(taskId);
            },
            async (taskId) => {
                // Task timeout — iOS forced us to stop
                console.log('[BackgroundFetch] TIMEOUT:', taskId);
                BackgroundFetch.finish(taskId);
            }
        );
        console.log('[BackgroundFetch] Configured, status:', fetchStatus);
    } catch (error) {
        console.error('[BackgroundFetch] Configure error:', error);
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
        if (httpSubscription) {
            httpSubscription.remove();
            httpSubscription = null;
        }
        if (heartbeatSubscription) {
            heartbeatSubscription.remove();
            heartbeatSubscription = null;
        }
        await BackgroundGeolocation.stop();
        console.log('[stop] Tracking stopped');
    } catch (error) {
        console.error('Error stopping location tracking:', error);


    }
}