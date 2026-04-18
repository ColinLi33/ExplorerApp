import { AppRegistry } from 'react-native';
import App from './App';
import BackgroundGeolocation from 'react-native-background-geolocation';
import BackgroundFetch from 'react-native-background-fetch';

// Register the main app component
AppRegistry.registerComponent('main', () => App);

/**
 * BackgroundGeolocation Headless Task
 * 
 * This runs when the app has been terminated by Android but the plugin
 * continues to operate in the background. Without this, location events
 * are silently dropped when the app isn't in memory.
 */
const BackgroundGeolocationHeadlessTask = async (event) => {
    const { name, params } = event;
    console.log('[HeadlessTask]', name, JSON.stringify(params).substring(0, 200));

    switch (name) {
        case 'location':
        case 'motionchange':
            // The plugin's built-in HTTP service handles syncing to the server
            // automatically (configured via `url` in LocationService.js).
            // Nothing extra needed here — just let it run.
            console.log(`[HeadlessTask] ${name}: lat=${params.location?.coords?.latitude}, lng=${params.location?.coords?.longitude}`);
            break;

        case 'heartbeat':
            // On heartbeat, force a location update to make sure we have fresh data
            try {
                const location = await BackgroundGeolocation.getCurrentPosition({
                    samples: 1,
                    persist: true,
                    extras: { headless: true },
                });
                console.log('[HeadlessTask] heartbeat location:', location.coords.latitude, location.coords.longitude);
            } catch (error) {
                console.log('[HeadlessTask] heartbeat getCurrentPosition error:', error);
            }
            break;

        case 'terminate':
            // App was terminated — plugin will continue running natively.
            console.log('[HeadlessTask] App terminated, background tracking continues');
            break;

        case 'http':
            // HTTP sync event
            if (params.success) {
                console.log('[HeadlessTask] HTTP sync success');
            } else {
                console.log('[HeadlessTask] HTTP sync failed:', params.status);
            }
            break;

        case 'activitychange':
            console.log(`[HeadlessTask] Activity: ${params.activity}, confidence: ${params.confidence}%`);
            break;

        case 'providerchange':
            console.log(`[HeadlessTask] Provider change: enabled=${params.enabled}`);
            break;
    }
};

// Register the headless task - this is what allows the plugin to
// continue delivering events after Android kills the app.
BackgroundGeolocation.registerHeadlessTask(BackgroundGeolocationHeadlessTask);

/**
 * BackgroundFetch Headless Task
 * 
 * react-native-background-fetch periodically wakes the app (every ~15 min)
 * which helps keep the location tracking service alive on aggressive
 * Android OEMs (Samsung, Xiaomi, etc.) that kill background services.
 */
const BackgroundFetchHeadlessTask = async (event) => {
    const taskId = event.taskId;
    const isTimeout = event.timeout;

    if (isTimeout) {
        console.log('[BackgroundFetch HeadlessTask] TIMEOUT:', taskId);
        BackgroundFetch.finish(taskId);
        return;
    }

    console.log('[BackgroundFetch HeadlessTask] Event:', taskId);
    // Just finishing the task is enough — the wakeup itself keeps
    // the location service alive.
    BackgroundFetch.finish(taskId);
};

BackgroundFetch.registerHeadlessTask(BackgroundFetchHeadlessTask);
