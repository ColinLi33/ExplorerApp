import React, { useState, useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, TextInput, Alert, StyleSheet, DeviceEventEmitter, ScrollView, TouchableOpacity, Switch, Platform } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import BackgroundGeolocation from 'react-native-background-geolocation';

import { addDebugLog, getDebugLogs } from '../utils/Logger';
import { loginUser, logoutUser, isTokenExpired, refreshAuthToken } from '../services/AuthService';
import { startLocationTracking, stopLocationTracking } from '../services/LocationService';
import * as ImagePicker from 'expo-image-picker';
import { baseURL } from '../services/ApiService';

const HomeScreen = ({ route, navigation }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState(null);
    const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);

    const [debugVisible, setDebugVisible] = useState(false);
    const [debugLogsState, setDebugLogsState] = useState([]);
    const [pluginLocationsCount, setPluginLocationsCount] = useState(0);
    const [isUploading, setIsUploading] = useState(false);

    // Load persistent tracking preference
    useEffect(() => {
        const loadTrackingPreference = async () => {
            try {
                const storedPreference = await AsyncStorage.getItem('isTrackingEnabled');
                if (storedPreference !== null) {
                    setIsTrackingEnabled(JSON.parse(storedPreference));
                }
            } catch (error) {
                console.error('Error loading tracking preference:', error);
            }
        };
        loadTrackingPreference();
    }, []);

    // Toggle Tracking Handler
    const toggleTracking = async (value) => {
        setIsTrackingEnabled(value);
        try {
            await AsyncStorage.setItem('isTrackingEnabled', JSON.stringify(value));
        } catch (error) {
            console.error('Error saving tracking preference:', error);
        }
    };

    // Update tracking based on userId AND tracking preference
    useEffect(() => {
        if (userId !== null && isTrackingEnabled) {
            startLocationTracking();
        } else {
            stopLocationTracking();
        }
    }, [userId, isTrackingEnabled]);

    useEffect(() => {
        const loadTokens = async () => {
            const storedAccessToken = await AsyncStorage.getItem('accessToken');
            const storedRefreshToken = await AsyncStorage.getItem('refreshToken');
    
            if(storedAccessToken && !await isTokenExpired(storedAccessToken)) {
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

        loadTokens();
    }, []);

    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    useEffect(() => {
       const debugSubscription = DeviceEventEmitter.addListener('debugLogAdded', () => {
            setDebugLogsState([...getDebugLogs()]);
        });
        return () => debugSubscription.remove();
    }, []);

    // Polling for plugin stats
    useEffect(() => {
        const updateStats = async () => {
            // Update queue size from plugin
            try {
                const count = await BackgroundGeolocation.getCount();
                setPluginLocationsCount(count);
            } catch (e) {
                console.log('Failed to get plugin count', e);
            }
            forceUpdate();
        };

        const interval = setInterval(updateStats, 5000); // Poll every 5 seconds
        updateStats(); // Initial call
        
        return () => clearInterval(interval);
    }, []);

    const login = async () => {
        try {
            const data = await loginUser(username, password);
            setUserId(data.userId);
        } catch (error) {
            console.error('Login error:', error);
            Alert.alert('Error', error.message);
        }
    };

    const logout = async () => {
        try {
            await logoutUser();
            setUsername('');
            setPassword('');
            
            await stopLocationTracking();
            
            setUserId(null);
        } catch (error) {
            console.error('Log out error:', error);
            Alert.alert('Error', error.message);
        }
    };

    // Debug: Check plugin's internal location database
    const checkPluginLocations = async () => {
        try {
            const locations = await BackgroundGeolocation.getLocations();
            setPluginLocationsCount(locations.length);
            if (locations.length > 0) {
                const first = locations[0];
                const last = locations[locations.length - 1];
                Alert.alert(
                    `Plugin Locations: ${locations.length}`,
                    `First: ${new Date(first.timestamp).toLocaleString()}\n` +
                    `Last: ${new Date(last.timestamp).toLocaleString()}\n\n` +
                    `Last coords: ${last.coords.latitude.toFixed(5)}, ${last.coords.longitude.toFixed(5)}`
                );
            } else {
                Alert.alert('Plugin Locations', 'No locations stored in plugin database');
            }
        } catch (error) {
            Alert.alert('Error', error.message);
        }
    };
    // Debug: Get current plugin state
    const checkPluginState = async () => {
        try {
            const state = await BackgroundGeolocation.getState();
            Alert.alert(
                'Plugin State',
                `Enabled: ${state.enabled}\n` +
                `isMoving: ${state.isMoving}\n` +
                `didLaunchInBackground: ${state.didLaunchInBackground}\n` +
                `trackingMode: ${state.trackingMode}`
            );
        } catch (error) {
            Alert.alert('Error', error.message);
        }
    };

    const pickAndUploadPhotos = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Denied', 'We need access to your photos to pin them to the map.');
            return;
        }

        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            quality: 1,
            exif: true,
            legacy: true,
        });

        if (!result.canceled) {
            uploadPhotos(result.assets);
        }
    };

    const uploadPhotos = async (assets) => {
        setIsUploading(true);
        const accessToken = await AsyncStorage.getItem('accessToken');
        const formData = new FormData();

        assets.forEach((asset, index) => {
            const uri = asset.uri;
            const name = uri.split('/').pop();
            const type = 'image/jpeg';
            
            formData.append('photos', { 
                uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''), 
                name, 
                type 
            });
        });

        try {
            const response = await fetch(`${baseURL}/upload-photo`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'multipart/form-data',
                },
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const data = await response.json();
            
            let message = `${data.saved} photos uploaded successfully.`;
            if (data.failed > 0) {
                message += `\n\n${data.failed} photos failed:`;
                data.errors.forEach(err => {
                    message += `\n- ${err.filename}: ${err.reason}`;
                });
            }

            Alert.alert('Upload Complete', message);

        } catch (error) {
            console.error('Upload error:', error);
            Alert.alert('Upload Error', 'Failed to upload photos. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <View style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <StatusBar backgroundColor="#0A0A0A" barStyle="light-content" />
                
                {!userId ? (
                    <View style={styles.loginContainer}>
                        <View style={styles.header}>
                            <Text style={styles.appTitle}>EXPLORER</Text>
                            <Text style={styles.tagline}>Uncover Your World</Text>
                        </View>
                        
                        <View style={styles.loginCard}>
                            <TextInput
                                style={styles.input}
                                placeholder="Username"
                                placeholderTextColor="#666"
                                value={username}
                                onChangeText={setUsername}
                            />
                            <TextInput
                                style={styles.input}
                                placeholder="Password"
                                placeholderTextColor="#666"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                            />
                            <TouchableOpacity style={styles.primaryButton} onPress={login}>
                                <Text style={styles.primaryButtonText}>Login</Text>
                            </TouchableOpacity>
                            
                            <TouchableOpacity onPress={() => navigation.navigate('Registration')}>
                                <Text style={styles.linkText}>Create Account</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <View style={styles.homeContainer}>
                        <View style={styles.header}>
                            <Text style={styles.appTitle}>EXPLORER</Text>
                            <Text style={styles.welcomeText}>Welcome, {username}</Text>
                        </View>
                        
                        <View style={styles.statsCard}>
                            <View style={styles.statItem}>
                                <Text style={styles.statLabel}>Queue Size</Text>
                                <Text style={styles.statValue}>{pluginLocationsCount}</Text>
                            </View>
                            <View style={styles.statItem}>
                                <Text style={styles.statLabel}>Tracking</Text>
                                <Switch
                                    trackColor={{ false: "#767577", true: "#00E5FF" }}
                                    thumbColor={isTrackingEnabled ? "#f4f3f4" : "#f4f3f4"}
                                    onValueChange={toggleTracking}
                                    value={isTrackingEnabled}
                                />
                            </View>
                        </View>

                        <View style={styles.actionsContainer}>
                            <TouchableOpacity 
                                style={styles.primaryButton} 
                                onPress={async () => {
                                    try {
                                        const accessToken = await AsyncStorage.getItem('accessToken');
                                        navigation.navigate('Map', { username, token: accessToken });
                                    } catch (error) {
                                        console.error('Error opening map:', error);
                                        Alert.alert('Error', 'Failed to open map');
                                    }
                                }}
                            >
                                <Text style={styles.primaryButtonText}>View Map</Text>
                            </TouchableOpacity>

                            <TouchableOpacity 
                                style={[styles.primaryButton, { backgroundColor: '#FFD700' }, isUploading && { opacity: 0.5 }]} 
                                onPress={pickAndUploadPhotos}
                                disabled={isUploading}
                            >
                                <Text style={[styles.primaryButtonText, { color: '#000' }]}>
                                    {isUploading ? "Uploading..." : "Pin Photos"}
                                </Text>
                            </TouchableOpacity>
                            
                            <TouchableOpacity 
                                style={styles.secondaryButton}
                                onPress={() => setDebugVisible(!debugVisible)}
                            >
                                <Text style={styles.secondaryButtonText}>
                                    {debugVisible ? "Hide Debug" : "Show Debug"}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.logoutButton} onPress={logout}>
                                <Text style={styles.logoutButtonText}>Logout</Text>
                            </TouchableOpacity>
                        </View>

                        {debugVisible && (
                            <View style={styles.debugCard}>
                                <Text style={styles.debugTitle}>Plugin Debug</Text>
                                
                                <View style={styles.debugButtonRow}>
                                    <TouchableOpacity 
                                        style={styles.debugButton} 
                                        onPress={checkPluginLocations}
                                    >
                                        <Text style={styles.debugButtonText}>Check Locations ({pluginLocationsCount})</Text>
                                    </TouchableOpacity>
                                    
                                    <TouchableOpacity 
                                        style={styles.debugButton} 
                                        onPress={checkPluginState}
                                    >
                                        <Text style={styles.debugButtonText}>Check State</Text>
                                    </TouchableOpacity>
                                </View>
                                
                                <Text style={[styles.debugTitle, { marginTop: 16 }]}>Console Logs</Text>
                                <ScrollView style={styles.debugScrollView} nestedScrollEnabled={true}>
                                    {debugLogsState.map((log, index) => (
                                        <Text key={index} style={styles.debugText}>{log}</Text>
                                    ))}
                                </ScrollView>
                            </View>
                        )}
                    </View>
                )}
            </SafeAreaView>
        </View>
    );
}
    
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    safeArea: {
        flex: 1,
    },
    header: {
        alignItems: 'center',
        marginBottom: 40,
    },
    appTitle: {
        fontSize: 36,
        fontWeight: '700',
        letterSpacing: 4,
        color: '#00E5FF',
        marginBottom: 8,
    },
    tagline: {
        fontSize: 14,
        color: '#888',
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    welcomeText: {
        fontSize: 16,
        color: '#BBB',
        marginTop: 8,
    },
    loginContainer: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    homeContainer: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 60,
    },
    loginCard: {
        backgroundColor: '#1A1A1A',
        borderRadius: 16,
        padding: 24,
        borderWidth: 1,
        borderColor: '#222',
    },
    statsCard: {
        backgroundColor: '#1A1A1A',
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: '#222',
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statDivider: {
        width: 1,
        backgroundColor: '#333',
        marginHorizontal: 16,
    },
    statLabel: {
        fontSize: 12,
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
    },
    statValue: {
        fontSize: 18,
        color: '#00E5FF',
        fontWeight: '600',
    },
    input: {
        backgroundColor: '#0F0F0F',
        borderWidth: 1,
        borderColor: '#2A2A2A',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        color: '#FFF',
        fontSize: 16,
    },
    actionsContainer: {
        gap: 12,
    },
    primaryButton: {
        backgroundColor: '#00E5FF',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginBottom: 12,
    },
    primaryButtonText: {
        color: '#0A0A0A',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 1,
    },
    secondaryButton: {
        backgroundColor: '#1A1A1A',
        borderWidth: 1,
        borderColor: '#00E5FF',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginBottom: 12,
    },
    secondaryButtonText: {
        color: '#00E5FF',
        fontSize: 16,
        fontWeight: '600',
    },
    logoutButton: {
        backgroundColor: '#1A1A1A',
        borderWidth: 1,
        borderColor: '#FF5252',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
    },
    logoutButtonText: {
        color: '#FF5252',
        fontSize: 16,
        fontWeight: '600',
    },
    linkText: {
        color: '#00E5FF',
        fontSize: 14,
        textAlign: 'center',
        marginTop: 16,
    },
    debugCard: {
        backgroundColor: '#0F0F0F',
        borderRadius: 12,
        padding: 16,
        marginTop: 24,
        borderWidth: 1,
        borderColor: '#1A1A1A',
        height: 300,
    },
    debugTitle: {
        color: '#00E5FF',
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 12,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    debugScrollView: {
        flex: 1,
    },
    debugText: {
        color: '#00FF88',
        fontSize: 11,
        fontFamily: 'monospace',
        marginBottom: 4,
        lineHeight: 16,
    },
    debugButtonRow: {
        flexDirection: 'row',
        gap: 8,
    },
    debugButton: {
        flex: 1,
        backgroundColor: '#1A1A1A',
        borderWidth: 1,
        borderColor: '#00E5FF',
        borderRadius: 8,
        padding: 10,
        alignItems: 'center',
    },
    debugButtonText: {
        color: '#00E5FF',
        fontSize: 12,
        fontWeight: '600',
    },
});

export default HomeScreen;