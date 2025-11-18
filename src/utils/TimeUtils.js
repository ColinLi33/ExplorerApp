export const getRelativeTime = (timestamp) => {
    if (!timestamp) return '';
    
    const now = Date.now();
    const diffInMs = now - timestamp;
    const diffInMinutes = Math.round(diffInMs / (1000 * 60));
    
    if (diffInMinutes === 0) {
        return '0 minutes ago';
    } else if (diffInMinutes === 1) {
        return '1 minute ago';
    } else if (diffInMinutes < 60) {
        return `${diffInMinutes} minutes ago`;
    } else {
        const hours = Math.round(diffInMinutes / 60);
        if (hours === 1) {
            return '1 hour ago';
        } else if (hours < 24) {
            return `${hours} hours ago`;
        } else {
            const days = Math.round(hours / 24);
            if (days === 1) {
                return '1 day ago';
            } else {
                return `${days} days ago`;
            }
        }
    }
};
