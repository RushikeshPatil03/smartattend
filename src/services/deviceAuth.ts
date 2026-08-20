// src/services/deviceAuth.ts
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";
import apiClient from "./apiClient";
import { WebAuthnCredential } from "../types";

/**
 * Check if the browser environment supports WebAuthn APIs
 */
export function isWebAuthnSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/**
 * Check if the device has a platform hardware authenticator
 * (Apple Touch ID / Face ID, Android Biometrics, Windows Hello)
 */
export async function isPlatformAuthenticatorSupported(): Promise<boolean> {
  try {
    if (!isWebAuthnSupported()) return false;
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/**
 * Friendly error parser for WebAuthn native exceptions
 */
export function parseWebAuthnError(err: any): string {
  if (!err) return "Device passkey verification failed.";
  const name = err?.name || "";
  const msg = err?.message || "";

  if (name === "NotAllowedError") {
    return "Biometric or PIN verification was cancelled or timed out.";
  }
  if (name === "InvalidStateError") {
    return "This hardware authenticator is already registered.";
  }
  if (name === "NotSupportedError") {
    return "Your device or browser does not support hardware passkey binding.";
  }
  if (name === "SecurityError") {
    return "Hardware security origin mismatch. Please check your domain connection.";
  }
  if (name === "AbortError") {
    return "Authentication was aborted. Please try again.";
  }

  return msg || "Hardware passkey error occurred.";
}

/**
 * Register and bind this device's platform passkey (Touch ID, Face ID, Windows Hello, Android Keystore)
 */
export async function registerDevicePasskey(params: {
  token?: string;
  email?: string;
  name?: string;
  role?: string;
}): Promise<{
  ok: boolean;
  credential?: WebAuthnCredential;
  registrationResponse?: any;
  error?: string;
}> {
  try {
    if (!isWebAuthnSupported()) {
      return {
        ok: false,
        error: "Your browser does not support WebAuthn / Passkeys. Please update your browser.",
      };
    }

    // 1. Fetch registration options & one-time challenge from server
    const optRes = await apiClient.getWebAuthnRegisterOptions(params);
    if (!optRes?.ok || !optRes.options) {
      return {
        ok: false,
        error: optRes?.error || "Failed to initialize device passkey challenge.",
      };
    }

    const { options, challengeKey } = optRes;

    // 2. Prompt device hardware authenticator
    let registrationResponse: any;
    try {
      registrationResponse = await startRegistration({ optionsJSON: options });
    } catch (authErr: any) {
      return {
        ok: false,
        error: parseWebAuthnError(authErr),
      };
    }

    // 3. Verify attestation response on backend
    const verifyRes = await apiClient.verifyWebAuthnRegistration({
      response: registrationResponse,
      challengeKey,
    });

    if (!verifyRes?.ok || !verifyRes.credential) {
      return {
        ok: false,
        error: verifyRes?.error || "Backend passkey verification failed.",
      };
    }

    return {
      ok: true,
      credential: verifyRes.credential,
      registrationResponse,
    };
  } catch (err: any) {
    console.error("registerDevicePasskey error:", err);
    return {
      ok: false,
      error: err?.message || "An unexpected error occurred during passkey registration.",
    };
  }
}

/**
 * Sign an authentication challenge with this device's registered hardware passkey
 */
export async function signAttendanceChallenge(params: {
  options?: any;
  challengeKey?: string;
  email?: string;
  role?: string;
  studentId?: string;
}): Promise<{
  ok: boolean;
  assertion?: any;
  challengeKey?: string;
  error?: string;
}> {
  try {
    if (!isWebAuthnSupported()) {
      return {
        ok: false,
        error: "WebAuthn not supported in this browser.",
      };
    }

    let options = params.options;
    let challengeKey = params.challengeKey;

    // If options not passed, fetch auth challenge options from backend
    if (!options || !challengeKey) {
      const optRes = await apiClient.getWebAuthnAuthOptions({
        email: params.email,
        role: params.role,
        studentId: params.studentId,
      });

      if (!optRes?.ok || !optRes.options) {
        return {
          ok: false,
          error: optRes?.error || "Failed to get authentication challenge.",
        };
      }

      options = optRes.options;
      challengeKey = optRes.challengeKey;
    }

    // Prompt device hardware chip to sign challenge
    let assertion: any;
    try {
      assertion = await startAuthentication({ optionsJSON: options });
    } catch (authErr: any) {
      return {
        ok: false,
        error: parseWebAuthnError(authErr),
      };
    }

    return {
      ok: true,
      assertion,
      challengeKey,
    };
  } catch (err: any) {
    console.error("signAttendanceChallenge error:", err);
    return {
      ok: false,
      error: err?.message || "Failed to sign hardware passkey assertion.",
    };
  }
}

export default {
  isWebAuthnSupported,
  isPlatformAuthenticatorSupported,
  parseWebAuthnError,
  registerDevicePasskey,
  signAttendanceChallenge,
};
