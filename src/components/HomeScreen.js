import React, { useState, useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageBackground, Image, View, Text, TextInput, Button, Alert, StyleSheet, Linking, DeviceEventEmitter, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import * as TaskManager from 'expo-task-manager';
import CryptoJS from 'crypto-js';

const baseURL = 'https://colinli.me';
const LOCATION_TRACKING = 'location-tracking';

let debugLogs = [];
const MAX_DEBUG_LOGS = 500;

const addDebugLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    debugLogs.unshift(logEntry);
    if (debugLogs.length > MAX_DEBUG_LOGS) {
        debugLogs = debugLogs.slice(0, MAX_DEBUG_LOGS);
    }
    DeviceEventEmitter.emit('debugLogAdded', logEntry);
};

const originalConsoleLog = console.log;
console.log = (...args) => {
    originalConsoleLog(...args);
    addDebugLog(args.join(' '));
};

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
}

const getRelativeTime = (timestamp) => {
    if (!timestamp) return '';
    
    const now = Date.now();
    const diffInMs = now - timestamp;
    const diffInMinutes = Math.round(diffInMs / (1000 * 60));
    
    if (diffInMinutes === 0) {
        return '0 minutes ago';
    } else if (diffInMinutes === 1) {
        return '1 minute ago';
    } else if (diffInMinutes < 60) {
        return `${diffInMinutes} minutes ago`;
    } else {
        const hours = Math.round(diffInMinutes / 60);
        if (hours === 1) {
            return '1 hour ago';
        } else if (hours < 24) {
            return `${hours} hours ago`;
        } else {
            const days = Math.round(hours / 24);
            if (days === 1) {
                return '1 day ago';
            } else {
                return `${days} days ago`;
            }
        }
    }
}

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

async function sendSavedLocationData(username) {
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

const startLocationTracking = async () => {
    const interval = 5000

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
        console.log("Location started?", await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING))
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING, {
            accuracy: Location.Accuracy.Highest,
            timeInterval: interval,
            showsBackgroundLocationIndicator: false,
            foregroundService: {
                notificationTitle: "Explorer",
                notificationBody: `Tracking your location`,
                notificationColor: "#ff0000",
            },
            pausesUpdatesAutomatically: false,
            killServiceOnDestroy: false,
        });
        console.log(`location tracking started with interval ${interval}ms`);
    } catch (error) {
        console.error('Failed to start location tracking:', error);
    }
};

const stopLocationTracking = async () => {
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

const HomeScreen = ({ route, navigation }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [savedLocationsCount, setSavedLocationsCount] = useState(0);
    const [clockTick, setClockTick] = useState(0);
    const [debugVisible, setDebugVisible] = useState(false);
    const [debugLogsState, setDebugLogsState] = useState([]);

    useEffect(() => {
        if (userId !== null) {
            startLocationTracking();
        } else {
            stopLocationTracking();
        }
    }, [userId]);

    useEffect(() => {
        const loadTokens = async () => {
            const storedAccessToken = await AsyncStorage.getItem('accessToken');
            const storedRefreshToken = await AsyncStorage.getItem('refreshToken');
            const lastUpdated = await AsyncStorage.getItem('lastUpdated');
    
            if(lastUpdated){
                setLastUpdated(parseInt(lastUpdated, 10));
            }
            if(storedAccessToken && !isTokenExpired(storedAccessToken)) {
                const decodedToken = jwtDecode(storedAccessToken);
                setUsername(decodedToken.username);
                setUserId(decodedToken.userId);
                await AsyncStorage.setItem('username', decodedToken.username);
                await AsyncStorage.setItem('accessToken', storedAccessToken);
                console.log('signing in as', decodedToken.username);
            } else if(storedRefreshToken){
                const newAccessToken = await refreshAuthToken();
                if(newAccessToken) {
                    const decodedToken = jwtDecode(newAccessToken);
                    setUsername(decodedToken.username);
                    setUserId(decodedToken.userId);
                    await AsyncStorage.setItem('username', decodedToken.username); 
                    await AsyncStorage.setItem('accessToken', newAccessToken);
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

    useEffect(() => {
        const subscription = DeviceEventEmitter.addListener('locationQueueUpdated', (count) => {
            setSavedLocationsCount(count);
        });

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

    useEffect(() => {
        const subscription = DeviceEventEmitter.addListener('lastUpdatedSet', (time) => {
            setLastUpdated(time);
        });

        const debugSubscription = DeviceEventEmitter.addListener('debugLogAdded', () => {
            setDebugLogsState([...debugLogs]);
        });

        const interval = setInterval(() => {
            setClockTick((t) => t + 1); 
        }, 60 * 1000); 

        return () => {
            subscription.remove();
            debugSubscription.remove();
            clearInterval(interval);
        };
    }, []);

    const login = async () => {
        try {
            const hashedPassword = hashPassword(password);
            
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password: hashedPassword }),
            };
            const response = await fetchWithTimeout(baseURL + '/login', options);

            if (!response.ok) {
                throw new Error('Login failed');
            }

            const data = await response.json();
            
            await AsyncStorage.setItem('accessToken', data.accessToken);
            await AsyncStorage.setItem('refreshToken', data.refreshToken);
            await AsyncStorage.setItem('username', username);
            
            setUserId(data.userId);
            Alert.alert('Login successful');
        } catch (error) {
            console.error('Login error:', error);
            Alert.alert('Error', error.message);
        }
    };

    const logout = async () => {
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
            await AsyncStorage.removeItem('username');
            await AsyncStorage.removeItem('locationData');
            await AsyncStorage.removeItem('lastUpdated');
            
            await stopLocationTracking();
            
            setUserId(null);
            setLastUpdated(null);
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
                                Location Last Sent: {getRelativeTime(lastUpdated)}
                            </Text>
                        )}
                        <Text style={styles.infoText}>Queued Locations: {savedLocationsCount}</Text>
                        <View style={styles.buttonContainer}>
                            <Button
                                title={debugVisible ? "Hide Debug" : "Show Debug"}
                                onPress={() => setDebugVisible(!debugVisible)}
                                color="#6C757D"
                            />
                        </View>
                        {debugVisible && (
                            <View style={styles.debugContainer}>
                                <Text style={styles.debugTitle}>Debug Console</Text>
                                <ScrollView style={styles.debugScrollView} nestedScrollEnabled={true}>
                                    {debugLogsState.map((log, index) => (
                                        <Text key={index} style={styles.debugText}>{log}</Text>
                                    ))}
                                </ScrollView>
                            </View>
                        )}

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
    },

    container: {
        flex: 1,
        padding: 20,
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

    buttonContainer: {
        marginTop: 10,
        width: '100%',
    },
    
    debugContainer: {
        width: '100%',
        height: 200,
        backgroundColor: '#000000',
        borderRadius: 8,
        marginTop: 10,
        padding: 10,
    },
    
    debugTitle: {
        color: '#00FF00',
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 5,
    },
    
    debugScrollView: {
        flex: 1,
    },
    
    debugText: {
        color: '#00FF00',
        fontSize: 10,
        fontFamily: 'monospace',
        marginBottom: 2,
    },
});

export default HomeScreen;