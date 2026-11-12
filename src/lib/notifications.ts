import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications';
import { registerDeviceToken, unregisterDeviceToken } from '@/modules/notifications/actions';
import { toSafeInternalPath } from '@/lib/safe-url';

let currentToken: string | null = null;
let listenersRegistered = false;
let listenersUserId: string | null = null;

function getDevicePlatform(): 'android' | 'ios' | 'web' {
  const platform = Capacitor.getPlatform();
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  return 'web';
}

export async function initPushNotifications(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  if (listenersRegistered && listenersUserId === userId) return;
  if (listenersRegistered) await cleanupPushNotifications();

  // Resolve permission before installing listeners. A denied permission must
  // not leave a global "registered" flag that blocks a later account switch
  // or a permission grant after returning from Android settings.
  const permResult = await PushNotifications.checkPermissions();
  let receivePermission = permResult.receive;
  if (receivePermission === 'prompt') {
    const reqResult = await PushNotifications.requestPermissions();
    receivePermission = reqResult.receive;
  }
  if (receivePermission !== 'granted') {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[FCM] Notification permission denied');
    }
    return;
  }

  listenersRegistered = true;
  listenersUserId = userId;

  if (process.env.NODE_ENV === 'development') {
    console.log('[FCM] Initializing push notifications for user:', userId);
  }
  await PushNotifications.addListener('registration', async (token: Token) => {
    currentToken = token.value;
    if (process.env.NODE_ENV === 'development') {
      console.log('[FCM] Registration token received');
    }
    try {
      await registerDeviceToken(token.value, getDevicePlatform());
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[FCM] Failed to register device token:', err);
      }
    }
  });

  await PushNotifications.addListener('registrationError', (err: unknown) => {
    if (process.env.NODE_ENV === 'development') {
      console.error('[FCM] Registration error:', err);
    }
  });

  await PushNotifications.addListener(
    'pushNotificationReceived',
    (notification: PushNotificationSchema) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[FCM] Foreground notification received', notification.id);
      }
      // Notification is displayed automatically by the OS when the app is in foreground
      // Add custom in-app handling here if needed
    }
  );

  await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action: ActionPerformed) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[FCM] Notification action performed');
      }
      const data = action.notification.data as Record<string, string> | undefined;
      const target = toSafeInternalPath(data?.url || data?.route);
      if (target) window.location.href = target;
    }
  );

  await PushNotifications.register();
}

export async function cleanupPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (currentToken) {
      await unregisterDeviceToken(currentToken);
    }
    await PushNotifications.removeAllListeners();
    listenersRegistered = false;
    listenersUserId = null;
    currentToken = null;
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[FCM] Cleanup error:', err);
    }
  }
}
