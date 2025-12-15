import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';

const baseURL = 'https://colinli.me';

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

export default function Registration() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [verifyPassword, setVerifyPassword] = useState('');
    const navigation = useNavigation();

    const handleRegister = async () => {
        if (!username || !password || !verifyPassword) {
            Alert.alert('Error', 'Please fill in all fields.');
            return;
        }
        if (password !== verifyPassword) {
            Alert.alert('Error', 'Passwords do not match.');
            return;
        }
        
        try {
            const hashedPassword = hashPassword(password);
            
            const url = baseURL + '/register';
            const data = {
                username: username,
                password: hashedPassword,
            };

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            })
                .then((response) => response.json())
                .then(async (json) => {
                    if (json.success) {
                        await AsyncStorage.setItem('accessToken', json.accessToken);
                        await AsyncStorage.setItem('refreshToken', json.refreshToken);
                        await AsyncStorage.setItem('username', username);
                        
                        // Navigate to home screen and reset stack so they can't go back to registration
                        navigation.reset({
                            index: 0,
                            routes: [{ name: 'Explorer' }],
                        });
                    } else {
                        Alert.alert('Error', json.message);
                    }
                })
                .catch((error) => {
                    console.error(error);
                    Alert.alert('Error', 'Something went wrong. Please try again later.');
                });
        } catch (error) {
            console.error('Password hashing error:', error);
            Alert.alert('Error', 'Password processing failed. Please try again.');
        }
    };

    return (
        <View style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <StatusBar backgroundColor="#0A0A0A" barStyle="light-content" />
                
                <View style={styles.contentContainer}>
                    <View style={styles.header}>
                        <Text style={styles.appTitle}>EXPLORER</Text>
                        <Text style={styles.subtitle}>Create Account</Text>
                    </View>

                    <View style={styles.formCard}>
                        <TextInput
                            value={username}
                            onChangeText={(text) => setUsername(text)}
                            placeholder="Username"
                            placeholderTextColor="#666"
                            style={styles.input}
                        />
                        <TextInput
                            value={password}
                            onChangeText={(text) => setPassword(text)}
                            placeholder="Password"
                            placeholderTextColor="#666"
                            secureTextEntry
                            style={styles.input}
                        />
                        <TextInput
                            value={verifyPassword}
                            onChangeText={(text) => setVerifyPassword(text)}
                            placeholder="Confirm Password"
                            placeholderTextColor="#666"
                            secureTextEntry
                            style={styles.input}
                        />
                        
                        <TouchableOpacity style={styles.primaryButton} onPress={handleRegister}>
                            <Text style={styles.primaryButtonText}>Create Account</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity onPress={() => navigation.goBack()}>
                            <Text style={styles.linkText}>Already have an account? Login</Text>
                        </TouchableOpacity>
                    </View>
                </View>
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
    contentContainer: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
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
    subtitle: {
        fontSize: 16,
        color: '#BBB',
        letterSpacing: 1,
    },
    formCard: {
        backgroundColor: '#1A1A1A',
        borderRadius: 16,
        padding: 24,
        borderWidth: 1,
        borderColor: '#222',
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
    linkText: {
        color: '#00E5FF',
        fontSize: 14,
        textAlign: 'center',
        marginTop: 16,
    },
});
