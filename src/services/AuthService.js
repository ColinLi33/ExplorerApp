import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import CryptoJS from 'crypto-js';
import { baseURL, fetchWithTimeout } from './ApiService';

export const hashPassword = (password) => {
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

export async function isTokenExpired(token) {
    if (!token) return true;
    try {
        const decoded = jwtDecode(token);
        return decoded.exp < Date.now() / 1000;
    } catch (error) {
        console.error('Error decoding token:', error);
        return true;
    }
}

export async function refreshAuthToken() {
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

export const loginUser = async (username, password) => {
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
    
    return data;
};

export const logoutUser = async () => {
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
    
    await AsyncStorage.removeItem('accessToken');
    await AsyncStorage.removeItem('refreshToken');
    await AsyncStorage.removeItem('username');
    await AsyncStorage.removeItem('locationData');
    await AsyncStorage.removeItem('lastUpdated');
};
