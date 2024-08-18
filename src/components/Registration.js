import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const baseURL = 'http://192.168.1.145:80'

export default function Registration() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [verifyPassword, setVerifyPassword] = useState('');
    const navigation = useNavigation();

    const handleRegister = () => {
        if(!username || !password || !verifyPassword) {
            Alert.alert('Error', 'Please fill in all fields.');
            return;
        }
        if(password !== verifyPassword) {
            Alert.alert('Error', 'Passwords do not match.');
            return;
        }
        const url = baseURL + '/register'; // Replace with your API endpoint
        const data = {
            username: username,
            password: password,
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
                    const userId = json.userId;
                    await AsyncStorage.setItem('accessToken', json.accessToken);
                    await AsyncStorage.setItem('refreshToken', json.refreshToken);
                    Alert.alert('Success', 'Account registered successfully!', [
                        {
                            text: 'OK',
                            onPress: () => navigation.navigate('Explorer', { userId, username }), 
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
    };

    return (
        <View>
            <Text>Username:</Text>
            <TextInput
                value={username}
                onChangeText={(text) => setUsername(text)}
                placeholder="Enter username"
            />
            <Text>Password:</Text>
            <TextInput
                value={password}
                onChangeText={(text) => setPassword(text)}
                placeholder="Enter password"
                secureTextEntry
            />
            <Text>Verify Password:</Text>
            <TextInput
                value={verifyPassword}
                onChangeText={(text) => setVerifyPassword(text)}
                placeholder="Verify password"
                secureTextEntry
            />
            <Button title="Register" onPress={handleRegister} />
        </View>
    );
}
