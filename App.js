import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import * as Location from 'expo-location';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Registration from './Registration';
import { jwtDecode } from 'jwt-decode';

const Stack = createStackNavigator();

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
    const [location, setLocation] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null);
    const [accessToken, setAccessToken] = useState(null);
    const [refreshToken, setRefreshToken] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [locationQueue, setLocationQueue] = useState([]);
    const [queueLength, setQueueLength] = useState(0);
    
    useEffect(() => {
        const loadTokensAndQueue = async () => {
            const storedAccessToken = await AsyncStorage.getItem('accessToken');
            const storedRefreshToken = await AsyncStorage.getItem('refreshToken');
            const storedQueue = await AsyncStorage.getItem('locationQueue');

            setAccessToken(storedAccessToken);
            setRefreshToken(storedRefreshToken);
            setLocationQueue(storedQueue ? JSON.parse(storedQueue) : []);
            setQueueLength(storedQueue.length);
        };
        loadTokensAndQueue();
    }, []);

    useEffect(() => {
        if (userId) {
            const intervalId = setInterval(() => {
                console.log("Fetching location")
                getLocation();
            }, 5000); //every 5 seconds send location

            return () => {
                clearInterval(intervalId);
                console.log("interval cleared")
            };
        }
    }, [userId]);

    const login = async () => {
        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            };
            const response = await fetchWithTimeout('http://192.168.1.145:80/login', options);

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
        let { status } = await Location.requestBackgroundPermissionsAsync();
        if (status !== 'granted') {
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
        sendLocationData({username, location: currentLocation}, token);
    };

    const sendLocationData = async (data, token) => {
        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(data),
            };
            const response = await fetchWithTimeout('http://192.168.1.145:80/update', options);

            if (!response.ok) {
                throw new Error('Failed to update location');
            }

            if (locationQueue.length > 0) {
                await processQueue(token);
            }

            const now = new Date();
            setLastUpdated(now);

            return response.json();
        } catch (error) {
            enqueueLocation(data);
            console.error('Location update error:', error);
        }
    };

    const enqueueLocation = async (locationData) => {
        console.log("Updating queue")
        const updatedQueue = [...locationQueue, locationData];
        console.log(updatedQueue)
        setLocationQueue(updatedQueue);
        setQueueLength(updatedQueue.length);
        await AsyncStorage.setItem('locationQueue', JSON.stringify(updatedQueue));
    };

    const processQueue = async (token) => {
        const queue = [...locationQueue];

        while (queue.length > 0) {
            const item = queue.shift();
            try {
                const options = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify(item),
                };
                const response = await fetchWithTimeout('http://192.168.1.145:80/update', options);

                if (!response.ok) {
                    throw new Error('Failed to update location');
                }

                //update state and storage with the reduced queue
                setLocationQueue(queue);
                setQueueLength(queue.length);
                await AsyncStorage.setItem('locationQueue', JSON.stringify(queue));
            } catch (error) {
                console.error('Error processing queue item:', error);
                break; //If error break and leave the remaining items in the queue
            }
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
            const response = await fetchWithTimeout('http://192.168.1.145:80/refresh-token', options);

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
            {!userId ? (
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
            ) : (
                <View>
                    {lastUpdated && <Text>Location Last Sent: {lastUpdated.toLocaleTimeString()}</Text>}
                    <Text>Queued Locations: {queueLength}</Text>
                </View>
            )}
        </View>
    );
};

const App = () => {
    return (
        <NavigationContainer>
            <Stack.Navigator initialRouteName="Home">
                <Stack.Screen name="Home" component={HomeScreen} />
                <Stack.Screen name="Registration" component={Registration} />
            </Stack.Navigator>
        </NavigationContainer>
    );
};

export default App;