import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { baseURL } from '../services/ApiService';

const MapScreen = ({ route, navigation }) => {
    const { username, viewUser, token } = route.params;
    const targetUser = viewUser || username;
    const mapUrl = `${baseURL}/map/${targetUser}?token=${token}&app=true`;

    return (
        <View style={styles.container}>
            <WebView
                source={{ uri: mapUrl }}
                style={styles.webview}
                onError={(syntheticEvent) => {
                    const { nativeEvent } = syntheticEvent;
                    console.error('WebView error: ', nativeEvent);
                }}
            />
            <TouchableOpacity 
                onPress={() => navigation.goBack()}
                style={styles.backButtonContainer}
            >
                <BlurView intensity={40} tint="dark" style={styles.backButton}>
                    <Text style={styles.backButtonText}>← Back</Text>
                </BlurView>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    webview: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    backButtonContainer: {
        position: 'absolute',
        top: 50,
        left: 16,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    backButton: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
    },
    backButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default MapScreen;
