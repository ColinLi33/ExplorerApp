import { DeviceEventEmitter } from 'react-native';

let debugLogs = [];
const MAX_DEBUG_LOGS = 500;

export const addDebugLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    debugLogs.unshift(logEntry);
    if (debugLogs.length > MAX_DEBUG_LOGS) {
        debugLogs = debugLogs.slice(0, MAX_DEBUG_LOGS);
    }
    DeviceEventEmitter.emit('debugLogAdded', logEntry);
};

export const getDebugLogs = () => debugLogs;

// Override console.log to capture logs
const originalConsoleLog = console.log;
console.log = (...args) => {
    originalConsoleLog(...args);
    addDebugLog(args.join(' '));
};
