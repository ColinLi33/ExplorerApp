import React, { useState, useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, TextInput, Alert, StyleSheet, DeviceEventEmitter, ScrollView, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

import { addDebugLog, getDebugLogs } from '../utils/Logger';
import { getRelativeTime } from '../utils/TimeUtils';
import { baseURL } from '../services/ApiService';
import { loginUser, logoutUser, isTokenExpired, refreshAuthToken } from '../services/AuthService';
import { startLocationTracking, stopLocationTracking } from '../services/LocationService';

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
            setDebugLogsState([...getDebugLogs()]);
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
            const data = await loginUser(username, password);
            setUserId(data.userId);
            Alert.alert('Login successful');
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
            setLastUpdated(null);
            setSavedLocationsCount(0);
            Alert.alert('Log out successful');
        } catch (error) {
            console.error('Log out error:', error);
            Alert.alert('Error', error.message);
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
                                <Text style={styles.statLabel}>Last Update</Text>
                                <Text style={styles.statValue}>
                                    {lastUpdated ? getRelativeTime(lastUpdated) : 'Never'}
                                </Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statLabel}>Queued Locations</Text>
                                <Text style={styles.statValue}>{savedLocationsCount}</Text>
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
                                <Text style={styles.debugTitle}>Debug Console</Text>
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
});

export default HomeScreen;