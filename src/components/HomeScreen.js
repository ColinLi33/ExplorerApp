import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import Slider from '@react-native-community/slider';
import * as TaskManager from 'expo-task-manager';

const baseURL = 'http://colinli.me'; //replace later
const LOCATION_TRACKING = 'location-tracking';

const fetchWithTimeout = async (url, options, timeout = 3000) => {//3 second timer on request
    const controller = new AbortController();
    const { signal } = controller;
    options = { ...options, signal };

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error('Request timeout'));
        }, timeout);

        fetch(url, options)
            .then((response) => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
};

const HomeScreen = ({ route, navigation }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null); //last time location was sent
    const [updateInterval, setUpdateInterval] = useState(5000); //tied to slider
    const [savedLocationsCount, setSavedLocationsCount] = useState(0);
    const [isSliding, setIsSliding] = useState(false); //for slider

    const startLocationTracking = async () => { //background task for location tracking
        try {
            TaskManager.defineTask(LOCATION_TRACKING, async ({ data, error }) => {
                if (error) {
                    console.log('LOCATION_TRACKING task ERROR:', error);
                    return;
                }
                if (data && userId) {
                    data = data.locations;
                    if(data.length > 1){
                        data = data[data.length - 1]; //get the most recent location
                    } else {
                        data = data[0]; //make it not a list
                    }
                    let token = await AsyncStorage.getItem('accessToken');

                    if (isTokenExpired(token)) {
                        console.log('Token expired');
                        token = await refreshAuthToken();
                        if (!token) {
                            Alert.alert('Error', 'Unable to refresh token. Please log in again.');
                            return;
                        }
                    }
                    await sendLocationDataWithRetry({ username, location: data }, token);
                    sendSavedLocationData();
                } else {
                    console.log('No data or user id');
                }
            });
            TaskManager.isTaskRegisteredAsync(LOCATION_TRACKING).then(async (tracking) => {
                if (!tracking) {
                    await Location.startLocationUpdatesAsync(LOCATION_TRACKING, {
                        accuracy: Location.Accuracy.Highest,
                        timeInterval: updateInterval,
                        distanceInterval: 0,
                        showsBackgroundLocationIndicator: true,
                        foregroundService: {
                            notificationTitle: "Using your location",
                            notificationBody: "Tracking your location to provide the best experience possible.",
                            notificationColor: "#ff0000",
                        },
                    });
                    console.log('Location tracking started with interval', updateInterval);
                }
            });
        } catch (error) {
            console.error('Failed to start location tracking:', error);
        }
    };

    const stopLocationTracking = () => {
        TaskManager.isTaskRegisteredAsync(LOCATION_TRACKING).then(async(tracking) => {
            if (tracking) {
                await Location.stopLocationUpdatesAsync(LOCATION_TRACKING);
            }
        });
        console.log('Location tracking stopped');
    };

    useEffect(() => {
        if (userId && updateInterval !== null && !isSliding){
            const restartLocationTracking = async() => {
                console.log("Restarting location tracking");
                await Promise.all([ //avoid race where startTracking finishes before stopTracking, turning it off
                    stopLocationTracking(),
                    new Promise((resolve) => setTimeout(resolve, 500)),
                ]);
                await startLocationTracking();
            };
            restartLocationTracking();
        } else if(userId != null && updateInterval === null && !isSliding) {
            stopLocationTracking();
        }
    }, [userId, updateInterval, isSliding]);

    useEffect(() => { //this runs when the app is first opened
        const loadTokens = async () => {
            const storedAccessToken = await AsyncStorage.getItem('accessToken');
            const storedRefreshToken = await AsyncStorage.getItem('refreshToken');

            if(storedAccessToken && !isTokenExpired(storedAccessToken)) {
                const decodedToken = jwtDecode(storedAccessToken);
                setUsername(decodedToken.username);
                setUserId(decodedToken.userId);
                console.log('signing in as', decodedToken.username);
            } else if(storedRefreshToken){
                const newAccessToken = await refreshAuthToken();
                if(newAccessToken) {
                    const decodedToken = jwtDecode(newAccessToken);
                    setUsername(decodedToken.username);
                    setUserId(decodedToken.userId);
                    console.log('Signing in as', decodedToken.username);
                }
            }
        };
        const config = async () => {
            let resf = await Location.requestForegroundPermissionsAsync();
            let resb = await Location.requestBackgroundPermissionsAsync();
            if (resf.status != 'granted' && resb.status !== 'granted') {
                console.log('Permission to access location was denied');
            } else {
                console.log('Permission to access location granted');
            }
        };

        loadTokens();
        config();
    }, []);

    const handleSliderChange = (value) => {
        let interval;
        switch (value) {
            case 0:
                interval = 1000; //1 second
                break;
            case 1:
                interval = 5000; //5 seconds
                break;
            case 2:
                interval = 10000; //10 seconds
                break;
            case 3:
                interval = 30000; //30 seconds
                break;
            case 4:
                interval = 60000; //1 minute
                break;
            case 5:
                interval = 120000; //2 minutes
                break;
            case 6:
                interval = 300000; //5 minutes
                break;
            case 7:
                interval = 600000; //10 minutes
                break;
            case 8:
                interval = 1800000; //30 minutes
                break;
            default:
                interval = null; //OFF
        }
        setUpdateInterval(interval);
    };

    const getIntervalText = () => { //displays text for slider
        if (updateInterval === null) {
            return 'OFF';
        } else if (updateInterval >= 60000) {
            return `${updateInterval / 60000}m`;
        } else {
            return `${updateInterval / 1000}s`;
        }
    };

    const login = async () => { //login handler
        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            };
            const response = await fetchWithTimeout(baseURL + '/login', options);

            if (!response.ok) {
                throw new Error('Login failed');
            }

            const data = await response.json();
            
            await AsyncStorage.setItem('accessToken', data.accessToken);
            await AsyncStorage.setItem('refreshToken', data.refreshToken);
            
            setUserId(data.userId);
            Alert.alert('Login successful');
        } catch (error) {
            console.error('Login error:', error);
            Alert.alert('Error', error.message);
        }
    };

    const logout = async () => { //log out handler
        try {
            const options = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            };
            const response = await fetchWithTimeout(baseURL + '/logout', options);

            if (!response.ok) {
                throw new Error('Log out failed');
            }
            setUsername('');
            setPassword('');
            
            await AsyncStorage.removeItem('accessToken');
            await AsyncStorage.removeItem('refreshToken');
            await AsyncStorage.removeItem('locationData');
            stopLocationTracking();
            setUserId(null);

            Alert.alert('Log out successful');
        } catch (error) {
            console.error('Log out error:', error);
            Alert.alert('Error', error.message);
        }
    };

    const isTokenExpired = (token) => { //checks if token is expired
        if (!token) return true;
        const decodedToken = jwtDecode(token);
        const currentTime = Date.now() / 1000;
        return decodedToken.exp < currentTime;
    };

    const sendLocationDataWithRetry = async (data, token) => { //data is an object with username and location
        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(data),
            };
            const response = await fetchWithTimeout(baseURL + '/update', options);

            if (!response.ok) {
                throw new Error('Failed to update location');
            }

            const now = new Date();
            setLastUpdated(now); //update last updated time for app

            return response.json();
        } catch (error) {
            console.error('Location update error:', error);
            await saveLocationDataToStorage(data.location);
            return false;
        }
    };

    const saveLocationDataToStorage = async (data) => { //data is an array of locations
        try {
            const existingData = await AsyncStorage.getItem('locationData');
            const locationDataArray = existingData ? JSON.parse(existingData) : [];
            locationDataArray.push(data);
            console.log('queued location');
            await AsyncStorage.setItem('locationData', JSON.stringify(locationDataArray));
            setSavedLocationsCount(locationDataArray.length);
        } catch (error) {
            console.error('Error saving location data:', error);
        }
    };

    const sendSavedLocationData = async () => { //send saved locations to server
        try {
            const savedData = await AsyncStorage.getItem('locationData');
            if (savedData) {
                const locationDataArray = JSON.parse(savedData);
                const token = await AsyncStorage.getItem('accessToken');
                if (locationDataArray.length > 0) {
                    const options = {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ username: username, location: locationDataArray }),
                    };
                    const response = await fetchWithTimeout(baseURL + '/update', options);

                    if (response.ok) {
                        await AsyncStorage.removeItem('locationData');
                        setSavedLocationsCount(0);
                        console.log('Cleared Queue');
                    } else {
                        console.error('Failed to send batch location data');
                    }
                }
            }
        } catch (error) {
            console.error('Error sending saved location data:', error);
        }
    };

    const refreshAuthToken = async () => { //refresh auth token using refreshToken
        try {
            const storedRefreshToken = await AsyncStorage.getItem('refreshToken');
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ refreshToken: storedRefreshToken }),
            };
            const response = await fetchWithTimeout(baseURL + '/refresh-token', options);

            if (!response.ok) {
                throw new Error('Failed to refresh token');
            }

            const data = await response.json();
            const newAccessToken = data.accessToken;
            const newRefreshToken = data.refreshToken;

            await AsyncStorage.setItem('accessToken', newAccessToken);
            await AsyncStorage.setItem('refreshToken', newRefreshToken);

            return newAccessToken;
        } catch (error) {
            console.error('Token refresh error:', error);
            return null;
        }
    };

    return (
        <View>
            {!userId ? (
                //this is the login screen
                <View>
                    <TextInput placeholder="Username" value={username} onChangeText={setUsername} />
                    <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
                    <Button title="Login" onPress={login} />
                    <View style={{ marginTop: 20 }}>
                        <Button title="Register" onPress={() => navigation.navigate('Registration')} />
                    </View>
                </View>
            ) : (
                //this is the home screen
                <View>
                    <Text>Signed in as: {username}</Text>
                    {lastUpdated && <Text>Location Last Sent: {lastUpdated.toLocaleTimeString()}</Text>}
                    <Text>Queued Locations: {savedLocationsCount}</Text>
                    <Text>Send Interval:</Text>
                    <Slider
                        minimumValue={0}
                        maximumValue={9}
                        step={1}
                        value={
                            updateInterval === 1000
                            ? 0
                            : updateInterval === 5000
                            ? 1
                            : updateInterval === 10000
                            ? 2
                            : updateInterval === 30000
                            ? 3
                            : updateInterval === 60000
                            ? 4
                            : updateInterval === 120000
                            ? 5
                            : updateInterval === 300000
                            ? 6
                            : updateInterval === 600000
                            ? 7
                            : updateInterval === 1800000
                            ? 8
                            : 9
                        }
                        onValueChange={handleSliderChange}
                        onSlidingStart={() => setIsSliding(true)}
                        onSlidingComplete={() => setIsSliding(false)}
                        minimumTrackTintColor="#000000"
                        maximumTrackTintColor="#000000"
                        thumbTintColor="#000000"
                    />
                    <Text>{getIntervalText()}</Text>
                    <Button title="Log Out" onPress={logout} />
                </View>
            )}
        </View>
    );
};

export default HomeScreen;