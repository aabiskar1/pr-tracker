// Shared state for the background script
export const state = {
    sessionPassword: null as string | null,
    rememberPassword: false,
    lastRefreshTime: 0,
    isCheckingPRs: false,
    lastNewPRNotificationTime: 0,
};

export const constants = {
    ALARM_NAME: 'check-prs',
    CHECK_INTERVAL: 5, // minutes
    PASSWORD_EXPIRY_ALARM: 'password-expiry',
    REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes in milliseconds
    NOTIFICATION_THROTTLE_MS: 30000, // 30 seconds
    NOTIFICATION_ICON: 'icons/icon-128.png',
};
