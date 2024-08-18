import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import Slider from '@react-native-community/slider';

const baseURL = 'http://192.168.1.145:80'; //replace later

const fetchWithTimeout = async (url, options, timeout = 3000) => { //5 second timer on request
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

const HomeScreen = ({ navigation }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState(null);
    const [location, setLocation] = useState(null); //current location
    const [errorMsg, setErrorMsg] = useState(null); //error message for location
    const [accessToken, setAccessToken] = useState(null);
    const [refreshToken, setRefreshToken] = useState(null); //used to refresh access token
    const [lastUpdated, setLastUpdated] = useState(null); //last time location was sent
    const [updateInterval, setUpdateInterval] = useState(5000); //tied to slider
    const [savedLocationsCount, setSavedLocationsCount] = useState(0);

    useEffect(() => {
        if (userId && updateInterval) {
            const intervalId = setInterval(() => {
                console.log("Fetching location");
                getLocation();
                sendSavedLocationData(); // Send saved location data
            }, updateInterval); //every 5 seconds send location

            return () => {
                clearInterval(intervalId);
                console.log("interval cleared");
            };
        }
    }, [userId, updateInterval]);

    useEffect(() => {
        const loadTokens = async () => {
            const storedAccessToken = await AsyncStorage.getItem('accessToken');
            const storedRefreshToken = await AsyncStorage.getItem('refreshToken');

            setAccessToken(storedAccessToken);
            setRefreshToken(storedRefreshToken);
        };
        loadTokens();
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

    const login = async () => {
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
            setUserId(data.userId);
            setAccessToken(data.accessToken);
            setRefreshToken(data.refreshToken);

            await AsyncStorage.setItem('accessToken', data.accessToken);
            await AsyncStorage.setItem('refreshToken', data.refreshToken);

            Alert.alert('Login successful');
        } catch (error) {
            console.error('Login error:', error);
            Alert.alert('Error', error.message);
        }
    };

    const isTokenExpired = (token) => {
        if (!token) return true;
        const decodedToken = jwtDecode(token);
        const currentTime = Date.now() / 1000;
        return decodedToken.exp < currentTime;
    };

    const getLocation = async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            console.log('Permission to access location was denied');
            setErrorMsg('Permission to access location was denied');
            return;
        }
        let { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        if (backgroundStatus !== 'granted') {
            //ask for permissions
            console.log('Permission to access location was denied');
            setErrorMsg('Permission to access location was denied');
            return;
        }

        let currentLocation = await Location.getCurrentPositionAsync({});
        setLocation(currentLocation);

        let token = accessToken;

        if (isTokenExpired(token)) {
            console.log('Token expired');
            token = await refreshAuthToken();
            if (!token) {
                Alert.alert('Error', 'Unable to refresh token. Please log in again.');
                return;
            }
        }
        const success = await sendLocationDataWithRetry({ username, location: currentLocation }, token);
    };

    const sendLocationDataWithRetry = async (data, token) => {
        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(data),
            };
            const response = await fetchWithTimeout(baseURL + '/update', options);

            if (!response.ok) {
                throw new Error('Failed to update location');
            }

            const now = new Date();
            setLastUpdated(now);

            return response.json();
        } catch (error) {
            console.error('Location update error:', error);
            await saveLocationDataToStorage(data.location);
            return false;
        }
    };

    const saveLocationDataToStorage = async (data) => {
        try {
            const existingData = await AsyncStorage.getItem('locationData');
            const locationDataArray = existingData ? JSON.parse(existingData) : [];
            locationDataArray.push(data);
            console.log("queued location")
            await AsyncStorage.setItem('locationData', JSON.stringify(locationDataArray));
            setSavedLocationsCount(locationDataArray.length);
        } catch (error) {
            console.error('Error saving location data:', error);
        }
    };

    const sendSavedLocationData = async () => {
        try {
            const savedData = await AsyncStorage.getItem('locationData');
            if (savedData) {
                const locationDataArray = JSON.parse(savedData);
                if (locationDataArray.length > 0) {
                    const options = {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${accessToken}`,
                        },
                        body: JSON.stringify({username: username, location: locationDataArray}),
                    };
                    const response = await fetchWithTimeout(baseURL + '/update', options);
    
                    if (response.ok) {
                        await AsyncStorage.removeItem('locationData');
                        setSavedLocationsCount(0);
                        console.log("Cleared Queue")
                    } else {
                        console.error('Failed to send batch location data');
                    }
                }
            }
        } catch (error) {
            console.error('Error sending saved location data:', error);
        }
    };

    const refreshAuthToken = async () => {
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

            setAccessToken(newAccessToken);
            setRefreshToken(newRefreshToken);
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
            {!userId ? ( //this is the login screen
                <View>
                    <TextInput
                        placeholder="Username"
                        value={username}
                        onChangeText={setUsername}
                    />
                    <TextInput
                        placeholder="Password"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />
                    <Button title="Login" onPress={login} />
                    <View style={{ marginTop: 20 }}>
                        <Button title="Register" onPress={() => navigation.navigate('Registration')} />
                    </View>
                </View>
            ) : ( //this is the home screen
                <View>
                    {lastUpdated && <Text>Location Last Sent: {lastUpdated.toLocaleTimeString()}</Text>}
                    <Text>Queued Locations: {savedLocationsCount}</Text>
                    <Text>Send Interval:</Text>
                    <Slider
                        minimumValue={0}
                        maximumValue={9}
                        step={1}
                        value={updateInterval === 1000 ? 0 : updateInterval === 5000 ? 1 : updateInterval === 10000 ? 2 : updateInterval === 30000 ? 3 : updateInterval === 60000 ? 4 : updateInterval === 120000 ? 5 : updateInterval === 300000 ? 6 : updateInterval === 600000 ? 7 : updateInterval === 1800000 ? 8 : 9}
                        onValueChange={handleSliderChange}
                        minimumTrackTintColor="#000000"
                        maximumTrackTintColor="#000000"
                        thumbTintColor="#000000"
                    />
                    <Text>{getIntervalText()}</Text>
                </View>
            )}
        </View>
    );
};

export default HomeScreen;