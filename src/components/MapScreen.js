import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
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
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <WebView
                    source={{ uri: mapUrl }}
                    style={styles.webview}
                    startInLoadingState={true}
                    renderLoading={() => (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color="#00E5FF" />
                            <Text style={styles.loadingText}>Loading map...</Text>
                        </View>
                    )}
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
            </SafeAreaView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    safeArea: {
        flex: 1,
    },
    webview: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    loadingContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0A0A0A',
    },
    loadingText: {
        marginTop: 16,
        color: '#FFF',
        fontSize: 16,
    },
    backButtonContainer: {
        position: 'absolute',
        top: 70,
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
