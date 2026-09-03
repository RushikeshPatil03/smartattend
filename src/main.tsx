import { initDeviceFingerprint } from "./services/attendanceClient";

// Initialize before React renders — ensures fingerprint is ready at login
void initDeviceFingerprint();

export { initDeviceFingerprint };
export default initDeviceFingerprint;
