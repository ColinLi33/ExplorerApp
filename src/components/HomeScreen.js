import React, { useState, useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageBackground, Image, View, Text, TextInput, Button, Alert, StyleSheet, Linking, DeviceEventEmitter } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import Slider from '@react-native-community/slider';
import * as TaskManager from 'expo-task-manager';
import CryptoJS from 'crypto-js';

const baseURL = 'https://colinli.me';
const LOCATION_TRACKING = 'location-tracking';

const hashPassword = (password) => {
    const salt = 'imsupersalty123'; 
    try {
        const passwordWithSalt = password + salt;
        const hash = CryptoJS.SHA256(passwordWithSalt).toString();
        return hash;
    } catch (error) {
        console.error('Hashing failed:', error);
        throw new Error('Password hashing failed');
    }
};

async function isTokenExpired(token) {
    if (!token) return true;
    try {
        const decoded = jwtDecode(token);
        return decoded.exp < Date.now() / 1000;
    } catch (error) {
        console.error('Error decoding token:', error);
        return true;
    }
}

async function refreshAuthToken() {
    try {
        const storedRefreshToken = await AsyncStorage.getItem('refreshToken');
        if (!storedRefreshToken) {
            console.log('No refresh token available');
            return null;
        }
        
        const response = await fetch(`${baseURL}/refresh-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: storedRefreshToken }),
        });
        
        if (!response.ok) {
            console.log('Failed to refresh token');
            return null;
        }
        
        const data = await response.json();
        await AsyncStorage.setItem('accessToken', data.accessToken);
        await AsyncStorage.setItem('refreshToken', data.refreshToken);
        return data.accessToken;
    } catch (error) {
        console.error('Token refresh error:', error);
        return null;
    }
}

const fetchWithTimeout = async (url, options, timeout = 3000) => {
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

async function saveLocationDataToStorage(data) {
    try {
        const existingData = await AsyncStorage.getItem('locationData');
        const locationDataArray = existingData ? JSON.parse(existingData) : [];
        locationDataArray.push(data);
        console.log('queued location');
        await AsyncStorage.setItem('locationData', JSON.stringify(locationDataArray));
    // Notify listeners (UI) of updated queue size
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
            if (locationDataArray.length > 0) {
                const options = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ username, location: locationDataArray }),
                };
                const response = await fetchWithTimeout(`${baseURL}/update`, options);
                if (response.ok) {
                    await AsyncStorage.removeItem('locationData');
                    console.log('Cleared Queue');
                    DeviceEventEmitter.emit('locationQueueUpdated', 0);
                    return true;
                } else {
                    console.error('Failed to send batch location data');
                    // Emit current size since it remains unchanged
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
        let token = await AsyncStorage.getItem('accessToken');
        if (await isTokenExpired(token)) {
            token = await refreshAuthToken();
            if (!token) {
                console.log('Could not refresh token in background task');
                return;
            }
        }
        const decoded = jwtDecode(token);
        const username = decoded.username;
        
        // Try to send the new location
        const success = await sendLocationDataWithRetry({ username, location: latest }, token);
        
        // If successful, also try to send any queued locations
        if (success) {
            await sendSavedLocationData(username);
        }
    } catch (e) {
        console.log('Error in background task handler:', e);
    }
});

const HomeScreen = ({ route, navigation }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null); //last time location was sent
    const [updateInterval, setUpdateInterval] = useState(5000); //tied to slider
    const [savedLocationsCount, setSavedLocationsCount] = useState(0);
    const [isSliding, setIsSliding] = useState(false); //for slider

    const startLocationTracking = async () => { //background task for location tracking
        console.log('starting tracking')
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
            TaskManager.isTaskRegisteredAsync(LOCATION_TRACKING).then(async (tracking) => {
                if (!tracking) {
                    await Location.startLocationUpdatesAsync(LOCATION_TRACKING, {
                        accuracy: Location.Accuracy.Highest,
                        timeInterval: updateInterval,
                        distanceInterval: 0,
                        showsBackgroundLocationIndicator: false,
                        foregroundService: {
                            notificationTitle: "Explorer",
                            notificationBody: "Tracking your location to provide the best experience possible.",
                            notificationColor: "#ff0000",
                        },
                        pausesUpdatesAutomatically: false,
                        killServiceOnDestroy: false,
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
        console.log('Userinfo', userId, updateInterval, isSliding)
        if (userId !== null && updateInterval !== null && !isSliding){
            const restartLocationTracking = async() => {
                console.log("Restarting location tracking");
                await Promise.all([ //avoid race where startTracking finishes before stopTracking, turning it off
                    stopLocationTracking(),
                    new Promise((resolve) => setTimeout(resolve, 500)),
                ]);
                await startLocationTracking();
            };
            restartLocationTracking();
        } else {
            stopLocationTracking();
        }
    }, [userId, updateInterval, isSliding]);

    // Automatic retry mechanism for queued locations
    useEffect(() => {
        if (userId !== null && savedLocationsCount > 0) {
            // Try to send queued locations every 30 seconds if there are any
            const retryInterval = setInterval(async () => {
                try {
                    const success = await sendSavedLocationData(username);
                    if (success) {
                        setSavedLocationsCount(0);
                        console.log('Successfully sent queued locations');
                    }
                } catch (error) {
                    console.log('Retry attempt failed, will try again later');
                }
            }, 30000); // 30 seconds
            return () => clearInterval(retryInterval);
        }
    }, [userId, savedLocationsCount, username]);

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
                console.log('Permission to access location was denied!');
            } else {
                console.log('Permission to access location granted!');
            }
        };

        loadTokens();
        config();
    }, []);

    // Listen for queue size updates (emitted from background tasks / save operations)
    useEffect(() => {
        const subscription = DeviceEventEmitter.addListener('locationQueueUpdated', (count) => {
            setSavedLocationsCount(count);
        });
        // Load initial count on mount
        const loadInitialQueueSize = async () => {
            try {
                const savedData = await AsyncStorage.getItem('locationData');
                const arr = savedData ? JSON.parse(savedData) : [];
                setSavedLocationsCount(arr.length);
            } catch (e) {
                console.log('Failed to load initial queue size', e);
            }
        };
        loadInitialQueueSize();
        return () => subscription.remove();
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
            const hashedPassword = hashPassword(password);
            
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password: hashedPassword }), // Hash password before sending
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
            setSavedLocationsCount(0);

            Alert.alert('Log out successful');
        } catch (error) {
            console.error('Log out error:', error);
            Alert.alert('Error', error.message);
        }
    };

    return (
        <ImageBackground
                source={require('../../assets/map-background2.jpg')}
                style={styles.backgroundImage}
        >
        <SafeAreaView style={styles.safeArea}>
            <StatusBar backgroundColor="#FFFFFF" barStyle="dark-content" />
            
            <View style={styles.container}>
                <View style={styles.headerContainer}>
                    <Text style={styles.header}>Explorer</Text>
                    <Image
                    source={require('../../assets/logo.png')}
                    style={styles.logo}
                    />
                </View>
                {!userId ? (
                    // Login Screen
                    <View style={styles.loginContainer}>
                        <TextInput
                            style={[styles.fullWidthInput, { marginBottom: 10 }]}
                            placeholder="Username"
                            value={username}
                            onChangeText={setUsername}
                        />
                        <TextInput
                            style={[styles.fullWidthInput, { marginBottom: 20 }]}
                            placeholder="Password"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                        />
                        <View style={styles.buttonBox}>
                            <Button title="Login" onPress={login} color="#007BFF" />
                        </View>
                        <Text
                            style={styles.registerText}
                            onPress={() => navigation.navigate('Registration')}
                        >
                            Register
                        </Text>
                    </View>
                ) : (
                    // Home Screen
                    <View style={styles.homeContainer}>
                        <Text style={styles.header}>Welcome, {username}</Text>
                        {lastUpdated && (
                            <Text style={styles.infoText}>
                                Location Last Sent: {lastUpdated.toLocaleTimeString()}
                            </Text>
                        )}
                        <Text style={styles.infoText}>Queued Locations: {savedLocationsCount}</Text>
                        <Text style={styles.infoText}>Send Interval:</Text>
                        <Slider
                            style={styles.slider}
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
                            minimumTrackTintColor="#007BFF"
                            maximumTrackTintColor="#6C757D"
                            thumbTintColor="#007BFF"
                        />
                        <Text style={styles.infoText}>{getIntervalText()}</Text>
                        <View style={styles.buttonContainer}>
                            <Button
                                title="View Your Map"
                                onPress={async () => {
                                    try {
                                        const accessToken = await AsyncStorage.getItem('accessToken');
                                        const mapUrl = `https://ColinLi.me/map/${username}?token=${accessToken}`;
                                        Linking.openURL(mapUrl);
                                    } catch (error) {
                                        console.error('Error opening map:', error);
                                        Alert.alert('Error', 'Failed to open map');
                                    }
                                }}
                                color="#007BFF"
                            />
                        </View>
                        <View style={styles.buttonContainer}>
                            <Button title="Log Out" onPress={logout} color="#DC3545" />
                        </View>
                    </View>
                )}
            </View>
        
        </SafeAreaView>
        </ImageBackground>
    );


    }

    
    const styles = StyleSheet.create({
        safeArea: {
            flex: 1,
            // backgroundColor: '#FFFFFF',
        },
        container: {
            flex: 1,
            padding: 20,
            // backgroundColor: '#FFFFFF',
        },

        backgroundImage: {
            flex: 1,
            resizeMode: 'cover', 
        },

        headerContainer: {
            alignItems: 'center',
            marginTop: 10,
        },
        header: {
            fontSize: 24,
            fontWeight: 'bold',
            textAlign: 'center',
            color: '#343A40',
        },
        loginContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
        fullWidthInput: {
            width: '100%',
            borderWidth: 1,
            borderColor: '#CED4DA',
            borderRadius: 8,
            padding: 10,
            backgroundColor: '#F8F9FA',
            color: '#495057',
            textAlign: 'center',
        },
        buttonBox: {
            width: '100%',
            borderWidth: 1,
            borderColor: '#CED4DA',
            borderRadius: 8,
            padding: 10,
            marginBottom: 15,
            backgroundColor: '#F8F9FA',
        },
        registerText: {
            fontSize: 14,
            color: '#007BFF',
            marginTop: 10,
            textAlign: 'center',
        },
        homeContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
        logo: {
            width: 100,
            height: 100,
            marginTop: 20,
            alignSelf: 'center',
            resizeMode: 'contain',
        },
        infoText: {
            fontSize: 16,
            color: '#495057',
            marginBottom: 10,
        },
        slider: {
            width: '100%',
            height: 40,
        },
        buttonContainer: {
            marginTop: 10,
            width: '100%',
        },
    });
export default HomeScreen;
