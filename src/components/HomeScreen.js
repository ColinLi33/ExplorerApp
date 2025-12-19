import React, { useState, useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, TextInput, Alert, StyleSheet, DeviceEventEmitter, ScrollView, TouchableOpacity, Switch, Platform } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import BackgroundGeolocation from 'react-native-background-geolocation';

import { loginUser, logoutUser, isTokenExpired, refreshAuthToken } from '../services/AuthService';
import { startLocationTracking, stopLocationTracking } from '../services/LocationService';
import * as ImagePicker from 'expo-image-picker';
import { baseURL } from '../services/ApiService';
import FriendsModal from './FriendsModal';
import { getFriendRequests } from '../services/FriendsService';

const HomeScreen = ({ route, navigation }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState(null);
    const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);

    const [isUploading, setIsUploading] = useState(false);
    const [isFriendsModalVisible, setIsFriendsModalVisible] = useState(false);
    const [hasPendingRequests, setHasPendingRequests] = useState(false);

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
        const checkRequests = async () => {
            if (userId) {
                try {
                    const token = await AsyncStorage.getItem('accessToken');
                    if (token) {
                        const data = await getFriendRequests(token);
                        setHasPendingRequests(data.requests && data.requests.length > 0);
                    }
                } catch (error) {
                    console.log('Error checking friend requests:', error);
                }
            }
        };
        checkRequests();
    }, [userId]);

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
            const validAssets = result.assets.filter(asset => {
                const hasGPS = asset.exif && (
                    (asset.exif.GPSLatitude !== undefined && asset.exif.GPSLongitude !== undefined) ||
                    (asset.exif['{GPS}'] && asset.exif['{GPS}'].Latitude !== undefined)
                );
                return hasGPS;
            });

            const skippedCount = result.assets.length - validAssets.length;
            if (skippedCount > 0) {
                Alert.alert(
                    'Photos Skipped',
                    `${skippedCount} photo${skippedCount > 1 ? 's were' : ' was'} skipped because they lack location metadata.`
                );
            }

            if (validAssets.length > 0) {
                uploadPhotos(validAssets);
            }
        }
    };


    const uploadPhotos = async (assets) => {
        const MAX_SIZE_MB = 100;
        const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
        
        // Calculate total size
        let totalSizeBytes = 0;
        assets.forEach(asset => {
            if (asset.fileSize) totalSizeBytes += asset.fileSize;
        });

        if (totalSizeBytes > MAX_SIZE_BYTES) {
            Alert.alert(
                'Upload Limit Exceeded', 
                `The total size of selected photos (${(totalSizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds the ${MAX_SIZE_MB}MB limit.`
            );
            return;
        }

        setIsUploading(true);
        
        try {
            const accessToken = await AsyncStorage.getItem('accessToken');
            if (!accessToken) {
                Alert.alert('Upload Error', 'You must be logged in to upload photos.');
                return;
            }

            const formData = new FormData();
            assets.forEach((asset, index) => {
                const uri = asset.uri;
                const name = asset.fileName || uri.split('/').pop() || `photo_${index}.jpg`;
                const type = 'image/jpeg';
                
                formData.append('photos', { 
                    uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''), 
                    name, 
                    type 
                });
            });

            // Get timezone offset in format like "-05:00"
            const getTimezoneOffset = () => {
                const offset = new Date().getTimezoneOffset();
                const sign = offset > 0 ? '-' : '+';
                const absOffset = Math.abs(offset);
                const hours = Math.floor(absOffset / 60).toString().padStart(2, '0');
                const minutes = (absOffset % 60).toString().padStart(2, '0');
                return `${sign}${hours}:${minutes}`;
            };

            const response = await fetch(`${baseURL}/upload-photo`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                    'X-Timezone-Offset': getTimezoneOffset(),
                },
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            
            let message = `${data.saved} photos uploaded successfully.`;
            if (data.duplicates > 0) message += `\n- ${data.duplicates} duplicates ignored.`;
            if (data.failed > 0) {
                message += `\n\n${data.failed} photos failed:`;
                data.errors.forEach(err => {
                    message += `\n- ${err.filename}: ${err.reason}`;
                });
            }

            Alert.alert('Upload Complete', message);

        } catch (error) {
            console.error('Upload error:', error);
            Alert.alert('Upload Error', `Failed to upload: ${error.message}`);
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
                                style={styles.secondaryButton} 
                                onPress={() => setIsFriendsModalVisible(true)}
                            >
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={styles.secondaryButtonText}>Friends</Text>
                                    {hasPendingRequests && <View style={styles.notificationBadge} />}
                                </View>
                            </TouchableOpacity>

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
                            
                            <TouchableOpacity style={styles.logoutButton} onPress={logout}>
                                <Text style={styles.logoutButtonText}>Logout</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
                
                <FriendsModal 
                    visible={isFriendsModalVisible}
                    onClose={() => setIsFriendsModalVisible(false)}
                    navigation={navigation}
                    onUpdateBadge={setHasPendingRequests}
                />
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
    notificationBadge: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#FF5252',
        marginLeft: 8,
    },
});

export default HomeScreen;