import BackgroundGeolocation from "react-native-background-geolocation";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { baseURL, fetchWithTimeout } from './ApiService';

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

export const startLocationTracking = async () => {
    BackgroundGeolocation.onLocation(async (location) => {
        console.log('[onLocation]', location);
        
        const storedUsername = await AsyncStorage.getItem('username');
        const storedToken = await AsyncStorage.getItem('accessToken');
        
        if (!storedUsername || !storedToken) {
            console.log('No username or token available in background task');
            return;
        }
        const success = await sendLocationDataWithRetry({ username: storedUsername, location: location }, storedToken);
        if (success) {
            sendSavedLocationData(storedUsername);
        }
    }, (error) => {
        console.log('[onLocation] ERROR:', error);
    });

    BackgroundGeolocation.onMotionChange((event) => {
        console.log('[onMotionChange]', event);
    });

    BackgroundGeolocation.onProviderChange((event) => {
        console.log('[onProviderChange]', event);
    });

    BackgroundGeolocation.ready({
        desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
        stopTimeout: 5,
        stopOnTerminate: false, 
        startOnBoot: true,      
    }).then((state) => {
        console.log("- BackgroundGeolocation is configured and ready: ", state.enabled);

        if (!state.enabled) {
            BackgroundGeolocation.start(function() {
                console.log("- Start success");
            });
        }
    });
};

export const stopLocationTracking = async () => {
    BackgroundGeolocation.stop();
    BackgroundGeolocation.removeListeners();
    console.log('Location tracking stopped');
};

