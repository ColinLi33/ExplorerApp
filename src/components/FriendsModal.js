import React, { useState, useEffect, useRef } from 'react';
import { 
    Modal, 
    View, 
    Text, 
    StyleSheet, 
    TouchableOpacity, 
    TextInput, 
    FlatList, 
    ActivityIndicator, 
    Alert,
    ScrollView,
    Animated
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFriends, getFriendRequests, sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend } from '../services/FriendsService';

const FriendsModal = ({ visible, onClose, navigation, onUpdateBadge }) => {
    const [friends, setFriends] = useState([]);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sending, setSending] = useState(false);
    
    const [feedback, setFeedback] = useState({ message: '', type: '' });
    const fadeAnim = useRef(new Animated.Value(0)).current;

    const showFeedback = (message, type) => {
        setFeedback({ message, type });
        Animated.sequence([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }),
            Animated.delay(2000),
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }),
        ]).start();
    };

    useEffect(() => {
        if (visible) {
            loadData();
        }
    }, [visible]);

    const loadData = async () => {
        setLoading(true);
        try {
            const token = await AsyncStorage.getItem('accessToken');
            if (!token) return;

            const [friendsData, requestsData] = await Promise.all([
                getFriends(token),
                getFriendRequests(token)
            ]);

            setFriends(friendsData.friends || []);
            setRequests(requestsData.requests || []);
            
            if (onUpdateBadge) {
                onUpdateBadge(requestsData.requests && requestsData.requests.length > 0);
            }

        } catch (error) {
            console.error('Error loading friends data:', error);
            Alert.alert('Error', 'Failed to load friends data');
        } finally {
            setLoading(false);
        }
    };

    const handleSendRequest = async () => {
        if (!searchQuery.trim()) return;
        
        setSending(true);
        try {
            const token = await AsyncStorage.getItem('accessToken');
            await sendFriendRequest(token, searchQuery);
            showFeedback('Friend request sent!', 'success');
            setSearchQuery('');
            loadData(); 
        } catch (error) {
            showFeedback(error.message, 'error');
        } finally {
            setSending(false);
        }
    };

    const handleAcceptRequest = async (username) => {
        try {
            const token = await AsyncStorage.getItem('accessToken');
            await acceptFriendRequest(token, username);
            showFeedback('Request accepted', 'success');
            loadData();
        } catch (error) {
            showFeedback(error.message, 'error');
        }
    };

    const handleDeclineRequest = async (username) => {
        try {
            const token = await AsyncStorage.getItem('accessToken');
            await declineFriendRequest(token, username);
            showFeedback('Request declined', 'success');
            loadData();
        } catch (error) {
            showFeedback(error.message, 'error');
        }
    };

    const handleRemoveFriend = async (username) => {
        Alert.alert(
            'Remove Friend',
            `Are you sure you want to remove ${username}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                { 
                    text: 'Remove', 
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const token = await AsyncStorage.getItem('accessToken');
                            await removeFriend(token, username);
                            showFeedback('Friend removed', 'success');
                            loadData();
                        } catch (error) {
                            showFeedback(error.message, 'error');
                        }
                    }
                }
            ]
        );
    };

    const handleViewMap = async (username) => {
        try {
            const token = await AsyncStorage.getItem('accessToken');
            const myUsername = await AsyncStorage.getItem('username');
            onClose();
            navigation.navigate('Map', { username: myUsername, viewUser: username, token });
        } catch (error) {
            console.error('Error navigating to map:', error);
        }
    };

    const renderFriendItem = ({ item }) => (
        <View style={styles.itemContainer}>
            <Text style={styles.itemText}>{item.username}</Text>
            <View style={styles.actionButtons}>
                {(item.visibility === 'public' || item.visibility === 'friends') && (
                    <TouchableOpacity 
                        style={styles.viewMapBtn}
                        onPress={() => handleViewMap(item.username)}
                    >
                        <Text style={styles.viewMapBtnText}>Map</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity 
                    style={styles.removeBtn}
                    onPress={() => handleRemoveFriend(item.username)}
                >
                    <Text style={styles.removeBtnText}>×</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    const renderRequestItem = ({ item }) => (
        <View style={styles.itemContainer}>
            <Text style={styles.itemText}>{item}</Text>
            <View style={styles.actionButtons}>
                <TouchableOpacity 
                    style={styles.acceptBtn}
                    onPress={() => handleAcceptRequest(item)}
                >
                    <Text style={styles.btnTextSmall}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={styles.declineBtn}
                    onPress={() => handleDeclineRequest(item)}
                >
                    <Text style={styles.btnTextSmall}>Decline</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Friends</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <Text style={styles.closeBtnText}>✕</Text>
                        </TouchableOpacity>
                    </View>

                    <Animated.View style={[styles.feedbackContainer, { opacity: fadeAnim }]}>
                        <Text style={[
                            styles.feedbackText, 
                            feedback.type === 'error' ? styles.errorText : styles.successText
                        ]}>
                            {feedback.message}
                        </Text>
                    </Animated.View>

                    <ScrollView style={styles.contentContainer}>
                        {/* Add Friend Section */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Add Friend</Text>
                            <View style={styles.addFriendContainer}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Username"
                                    placeholderTextColor="#666"
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    autoCapitalize="none"
                                />
                                <TouchableOpacity 
                                    style={[styles.sendBtn, sending && styles.disabledBtn]}
                                    onPress={handleSendRequest}
                                    disabled={sending}
                                >
                                    <Text style={styles.btnTextSmall}>
                                        {sending ? '...' : 'Add'}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {loading ? (
                            <ActivityIndicator size="large" color="#00E5FF" style={{ marginTop: 20 }} />
                        ) : (
                            <>
                                {/* Pending Requests Section */}
                                {requests.length > 0 && (
                                    <View style={styles.section}>
                                        <Text style={styles.sectionTitle}>Pending Requests</Text>
                                        <FlatList
                                            data={requests}
                                            renderItem={renderRequestItem}
                                            keyExtractor={item => item}
                                            scrollEnabled={false}
                                        />
                                    </View>
                                )}

                                {/* My Friends Section */}
                                <View style={styles.section}>
                                    <Text style={styles.sectionTitle}>My Friends</Text>
                                    {friends.length === 0 ? (
                                        <Text style={styles.emptyText}>No friends yet</Text>
                                    ) : (
                                        <FlatList
                                            data={friends}
                                            renderItem={renderFriendItem}
                                            keyExtractor={item => item.username}
                                            scrollEnabled={false}
                                        />
                                    )}
                                </View>
                            </>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.8)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        width: '90%',
        height: '80%',
        backgroundColor: '#1A1A1A',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#333',
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#00E5FF',
    },
    closeBtn: {
        padding: 5,
    },
    closeBtnText: {
        fontSize: 24,
        color: '#FFF',
    },
    contentContainer: {
        padding: 20,
    },
    section: {
        marginBottom: 25,
    },
    sectionTitle: {
        fontSize: 16,
        color: '#888',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    addFriendContainer: {
        flexDirection: 'row',
        gap: 10,
    },
    input: {
        flex: 1,
        backgroundColor: '#0F0F0F',
        borderWidth: 1,
        borderColor: '#333',
        borderRadius: 8,
        padding: 12,
        color: '#FFF',
    },
    sendBtn: {
        backgroundColor: '#00E5FF',
        borderRadius: 8,
        paddingHorizontal: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    disabledBtn: {
        opacity: 0.5,
    },
    itemContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#2A2A2A',
    },
    itemText: {
        color: '#FFF',
        fontSize: 16,
    },
    actionButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    viewMapBtn: {
        backgroundColor: '#1A1A1A',
        borderWidth: 1,
        borderColor: '#00E5FF',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
    },
    acceptBtn: {
        backgroundColor: '#00E5FF',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
    },
    declineBtn: {
        backgroundColor: '#FF5252',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
    },
    removeBtn: {
        padding: 5,
    },
    removeBtnText: {
        color: '#FF5252',
        fontSize: 24,
        lineHeight: 24,
    },
    btnTextSmall: {
        color: '#0A0A0A', // For primary buttons
        fontSize: 14,
        fontWeight: '600',
    },
    viewMapBtnText: {
        color: '#00E5FF',
    },
    emptyText: {
        color: '#666',
        fontStyle: 'italic',
    },
    feedbackContainer: {
        position: 'absolute',
        top: 70,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
    },
    feedbackText: {
        fontSize: 14,
        fontWeight: '600',
        paddingHorizontal: 20,
        paddingVertical: 8,
        borderRadius: 20,
        overflow: 'hidden',
    },
    successText: {
        color: '#0A0A0A',
        backgroundColor: '#69db7c',
    },
    errorText: {
        color: '#FFF',
        backgroundColor: '#ff6b6b',
    },
});

export default FriendsModal;
