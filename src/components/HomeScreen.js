import React, { useState, useEffect, useRef } from 'react';
import { StatusBar, Animated, LayoutAnimation, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, TextInput, Alert, StyleSheet, DeviceEventEmitter, ScrollView, TouchableOpacity, Switch, Platform, ImageBackground } from 'react-native';
import { BlurView } from 'expo-blur';
import CryptoJS from 'crypto-js';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

import { loginUser, logoutUser, isTokenExpired, refreshAuthToken } from '../services/AuthService';
import { startLocationTracking, stopLocationTracking } from '../services/LocationService';
import * as ImagePicker from 'expo-image-picker';
import { baseURL } from '../services/ApiService';
import FriendsModal from './FriendsModal';
import { getFriendRequests } from '../services/FriendsService';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

const HomeScreen = ({ route, navigation }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState(null);
    
    // Registration State
    const [isRegistering, setIsRegistering] = useState(false);
    const [regUsername, setRegUsername] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regVerifyPassword, setRegVerifyPassword] = useState('');
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;

    const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);
    const [visibility, setVisibility] = useState('private');

    const [isUploading, setIsUploading] = useState(false);
    const [isFriendsModalVisible, setIsFriendsModalVisible] = useState(false);
    const [hasPendingRequests, setHasPendingRequests] = useState(false);

    const fetchSettings = async () => {
        try {
            const token = await AsyncStorage.getItem('accessToken');
            if (!token) return;

            const response = await fetch(`${baseURL}/api/user/settings`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.settings) {
                    setVisibility(data.settings.visibility);
                }
            }
        } catch (error) {
            console.error('Error fetching settings:', error);
        }
    };

    const updateVisibility = async (newVisibility) => {
        const oldVisibility = visibility;
        setVisibility(newVisibility);
        
        try {
            const token = await AsyncStorage.getItem('accessToken');
            const response = await fetch(`${baseURL}/updatePrivacy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ visibility: newVisibility })
            });
            
            if (!response.ok) {
                setVisibility(oldVisibility);
                Alert.alert('Error', 'Failed to update visibility');
            }
        } catch (error) {
            setVisibility(oldVisibility);
            console.error('Error updating visibility:', error);
            Alert.alert('Error', 'Failed to update visibility');
        }
    };

    const toggleAuthMode = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setIsRegistering(!isRegistering);
    };

    const handleRegister = async () => {
        if (!regUsername || !regPassword || !regVerifyPassword) {
            Alert.alert('Error', 'Please fill in all fields.');
            return;
        }
        if (regPassword !== regVerifyPassword) {
            Alert.alert('Error', 'Passwords do not match.');
            return;
        }
        
        try {
            const hashedPassword = hashPassword(regPassword);
            
            const url = baseURL + '/register';
            const data = {
                username: regUsername,
                password: hashedPassword,
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            const json = await response.json();
            if (json.success) {
                await AsyncStorage.setItem('accessToken', json.accessToken);
                await AsyncStorage.setItem('refreshToken', json.refreshToken);
                await AsyncStorage.setItem('username', regUsername);
                
                // Auto login
                const decoded = jwtDecode(json.accessToken);
                setUserId(decoded.userId);
                setUsername(regUsername);
                
                // Reset state
                setRegUsername('');
                setRegPassword('');
                setRegVerifyPassword('');
                setIsRegistering(false);
            } else {
                Alert.alert('Error', json.message);
            }
        } catch (error) {
            console.error('Registration error:', error);
            Alert.alert('Error', 'Registration failed. Please try again.');
        }
    };

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
        if (userId) {
            fetchSettings();
        }
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
        <ImageBackground source={require('../../assets/space2.jpg')} style={styles.container} resizeMode="cover">
            <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
            <SafeAreaView style={styles.safeArea}>
                
                {!userId ? (
                    <View style={styles.loginContainer}>
                        <View style={styles.header}>
                            <Text style={styles.appTitle}>EXPLORER</Text>
                            <Text style={styles.tagline}>Uncover Your World</Text>
                        </View>
                        
                        {isRegistering ? (
                            <BlurView intensity={40} tint="dark" style={styles.loginCard}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Username"
                                    placeholderTextColor="#aaa"
                                    value={regUsername}
                                    onChangeText={setRegUsername}
                                />
                                <TextInput
                                    style={styles.input}
                                    placeholder="Password"
                                    placeholderTextColor="#aaa"
                                    value={regPassword}
                                    onChangeText={setRegPassword}
                                    secureTextEntry
                                />
                                <TextInput
                                    style={styles.input}
                                    placeholder="Confirm Password"
                                    placeholderTextColor="#aaa"
                                    value={regVerifyPassword}
                                    onChangeText={setRegVerifyPassword}
                                    secureTextEntry
                                />
                                <TouchableOpacity style={styles.primaryButton} onPress={handleRegister}>
                                    <Text style={styles.primaryButtonText}>Sign Up</Text>
                                </TouchableOpacity>
                                
                                <TouchableOpacity onPress={toggleAuthMode}>
                                    <Text style={styles.linkText}>Back to Login</Text>
                                </TouchableOpacity>
                            </BlurView>
                        ) : (
                            <BlurView intensity={40} tint="dark" style={styles.loginCard}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Username"
                                    placeholderTextColor="#aaa"
                                    value={username}
                                    onChangeText={setUsername}
                                />
                                <TextInput
                                    style={styles.input}
                                    placeholder="Password"
                                    placeholderTextColor="#aaa"
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry
                                />
                                <TouchableOpacity style={styles.primaryButton} onPress={login}>
                                    <Text style={styles.primaryButtonText}>Login</Text>
                                </TouchableOpacity>
                                
                                <TouchableOpacity onPress={toggleAuthMode}>
                                    <Text style={styles.linkText}>Create Account</Text>
                                </TouchableOpacity>
                            </BlurView>
                        )}
                    </View>
                ) : (
                    <View style={styles.homeContainer}>
                        <View style={styles.header}>
                            <Text style={styles.appTitle}>EXPLORER</Text>
                            <Text style={styles.welcomeText}>Welcome, {username}</Text>
                        </View>
                        
                        <BlurView intensity={40} tint="dark" style={styles.statsCard}>
                            <View style={styles.statItem}>
                                <Text style={styles.statLabel}>Tracking</Text>
                                <Switch
                                    trackColor={{ false: "#767577", true: "#4CAF50" }}
                                    thumbColor={isTrackingEnabled ? "#f4f3f4" : "#f4f3f4"}
                                    onValueChange={toggleTracking}
                                    value={isTrackingEnabled}
                                />
                            </View>
                            
                            <View style={styles.divider} />
                            
                            <View style={styles.visibilityContainer}>
                                <Text style={styles.statLabel}>Map Visibility</Text>
                                <View style={styles.visibilityControls}>
                                    {['private', 'friends', 'public'].map((mode) => (
                                        <TouchableOpacity
                                            key={mode}
                                            style={[
                                                styles.visibilityOption,
                                                visibility === mode && styles.visibilityOptionActive
                                            ]}
                                            onPress={() => updateVisibility(mode)}
                                        >
                                            <Text style={[
                                                styles.visibilityText,
                                                visibility === mode && styles.visibilityTextActive
                                            ]}>
                                                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </BlurView>

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
                                style={[styles.primaryButton, isUploading && { opacity: 0.5 }]} 
                                onPress={pickAndUploadPhotos}
                                disabled={isUploading}
                            >
                                <Text style={styles.primaryButtonText}>
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
        </ImageBackground>
    );
}
    
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000', // Fallback
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
        color: '#FFF',
        marginBottom: 8,
        textShadowColor: 'rgba(255, 255, 255, 0.5)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
    },
    tagline: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.7)',
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    welcomeText: {
        fontSize: 16,
        color: 'rgba(255, 255, 255, 0.8)',
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
        borderRadius: 16,
        padding: 24,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        overflow: 'hidden',
    },
    statsCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.5)',
        overflow: 'hidden',
    },
    statItem: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        marginVertical: 16,
    },
    visibilityContainer: {
        width: '100%',
    },
    visibilityControls: {
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        borderRadius: 8,
        padding: 4,
        marginTop: 12,
    },
    visibilityOption: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 6,
    },
    visibilityOptionActive: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
    visibilityText: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 12,
        fontWeight: '600',
    },
    visibilityTextActive: {
        color: '#FFF',
    },
    statLabel: {
        fontSize: 16,
        color: 'rgba(255, 255, 255, 0.8)',
        letterSpacing: 1,
    },
    input: {
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
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
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.5)',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginBottom: 12,
    },
    primaryButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 1,
    },
    secondaryButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.5)',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginBottom: 12,
    },
    secondaryButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    logoutButton: {
        backgroundColor: 'rgba(255, 82, 82, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255, 82, 82, 0.5)',
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
        color: '#FFF',
        fontSize: 14,
        textAlign: 'center',
        marginTop: 16,
        textDecorationLine: 'underline',
    },
    notificationBadge: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#FF5252',
        marginLeft: 8,
        shadowColor: "#FF5252",
        shadowOffset: {
            width: 0,
            height: 0,
        },
        shadowOpacity: 0.8,
        shadowRadius: 5,
        elevation: 5,
    },
});

export default HomeScreen;