import { baseURL } from './ApiService';

export const getFriends = async (token) => {
    const response = await fetch(`${baseURL}/api/friends`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) throw new Error('Failed to fetch friends');
    return await response.json();
};

export const getFriendRequests = async (token) => {
    const response = await fetch(`${baseURL}/api/friend-requests`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) throw new Error('Failed to fetch friend requests');
    return await response.json();
};

export const sendFriendRequest = async (token, toUsername) => {
    const response = await fetch(`${baseURL}/api/friend-request`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ toUsername }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message || 'Failed to send request');
    return data;
};

export const acceptFriendRequest = async (token, fromUsername) => {
    const response = await fetch(`${baseURL}/api/friend-request/accept`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fromUsername }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message || 'Failed to accept request');
    return data;
};

export const declineFriendRequest = async (token, fromUsername) => {
    const response = await fetch(`${baseURL}/api/friend-request/decline`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fromUsername }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message || 'Failed to decline request');
    return data;
};

export const removeFriend = async (token, friendUsername) => {
    const response = await fetch(`${baseURL}/api/friend/remove`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ friendUsername }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message || 'Failed to remove friend');
    return data;
};
