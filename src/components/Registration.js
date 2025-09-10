import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
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

            // Sending POST request
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
                        Alert.alert('Success', 'Account registered successfully!', [
                            {
                                text: 'OK',
                                onPress: () => navigation.navigate('Explorer'),
                            },
                        ]);
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
            <Text style={styles.label}>Username:</Text>
            <TextInput
                value={username}
                onChangeText={(text) => setUsername(text)}
                placeholder="Enter username"
                style={styles.input}
            />
            <Text style={styles.label}>Password:</Text>
            <TextInput
                value={password}
                onChangeText={(text) => setPassword(text)}
                placeholder="Enter password"
                secureTextEntry
                style={styles.input}
            />
            <Text style={styles.label}>Verify Password:</Text>
            <TextInput
                value={verifyPassword}
                onChangeText={(text) => setVerifyPassword(text)}
                placeholder="Verify password"
                secureTextEntry
                style={styles.input}
            />
            <TouchableOpacity style={styles.button} onPress={handleRegister}>
                <Text style={styles.buttonText}>Register</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 20,
    },
    label: {
        fontSize: 16,
        marginBottom: 5,
    },
    input: {
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 5,
        padding: 10,
        marginBottom: 15,
    },
    button: {
        backgroundColor: '#007BFF',
        padding: 15,
        borderRadius: 5,
        alignItems: 'center',
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
