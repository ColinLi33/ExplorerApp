import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const baseURL = 'http://192.168.1.145:80'

export default function Registration() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const navigation = useNavigation();

    const handleRegister = () => {
        if(!username || !password) {
            Alert.alert('Error', 'Please fill in all fields.');
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
            .then((json) => {
                if (json.success) {
                    Alert.alert('Success', 'Account registered successfully!', [
                        {
                            text: 'OK',
                            onPress: () => navigation.navigate('Home'), 
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
            <Button title="Register" onPress={handleRegister} />
        </View>
    );
}
