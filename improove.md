# Role & Objective
Act as an experienced Senior Full-Stack Developer. Refactor the Faculty and Student attendance dashboards to improve User Experience (UX), eliminate redundant clicks, and optimize rendering performance.

---

## 1. Faculty Dashboard Refactoring

### A. Attendance List UI/UX (Pop-up Modal Transformation)
*   **Current State:** The student list renders directly below the "Load Attendance" button. This causes a poor user experience and excessive vertical scrolling when handling large datasets (e.g., 100+ students).
*   **New Requirement:** 
    *   Remove the inline student list from below the button.
    *   When the faculty clicks the "Load" button (positioned next to the QR code), trigger a clean, responsive **Pop-up Modal / Overlay Window**.
    *   **Modal Header:** Include a **Refresh** button in the corner, and a **Close (X)** button directly above it to dismiss the modal.

### B. Student Grid Layout & Compact Design
*   Inside the modal, display the student list using a highly compact grid layout.
    *   **Grid Structure:** Implement a responsive grid that shows **8 columns** instead of 3.
    *   **Student Card UI:** Each student item must consist of a **Circular Profile Photo**, with their **USN (University Seat Number)** styled cleanly directly underneath the photo.
    *   **Hover Effect (Tooltip):** When the user hovers over a student card, display a native or custom tooltip showing both the student's **Full Name** and **USN**.

### C. Attendance Toggle Functionality (State Management)
*   Implement a toggle state directly on the student grid items:
    *   **Single Click:** Toggle the student's status to **Present** (visual indicator: green border or badge).
    *   **Double/Subsequent Click:** Toggle the status to **Absent** (visual indicator: red border or badge).
    *   Ensure state updates are performant and do not cause unnecessary re-renders of the entire grid.

### D. Full-Screen Automation
*   **Requirement:** When the faculty clicks the "Full Screen" button, the system must **automatically load and display the attendance data** directly next to the QR code inside the full-screen view. 
*   **Logic:** Bypass the need for the user to manually click the "Load Attendance" button when full-screen mode is triggered.

---

## 2. Student Dashboard Refactoring

### A. Camera Lifecycle Optimization
*   **Current State:** The student has to log in, wait, click "Mark Attendance", and then click a "Capture QR" button to start the camera, resulting in an extra, frustrating click.
*   **New Requirement:**
    *   **Pre-initialization:** Initialize and warm up the camera hardware permission/stream immediately upon successful **student login** in the background.
    *   **Direct Access:** When the student clicks the **"Mark Attendance"** button, open the camera view **immediately**.
    *   **Eliminate Redundancy:** Completely remove the "Capture QR" button and its separate trigger functionality. The "Mark Attendance" button must act as the sole direct trigger for the live camera stream.

---

## 3. Technical & Performance Constraints
*   Write clean, modular, and well-commented code.
*   Optimize grid rendering for 100+ items using virtual scrolling or efficient DOM recycling if necessary to avoid lag.
*   Ensure proper cleanup of the camera stream (`MediaStream.getTracks().forEach(track => track.stop())`) to avoid memory leaks and keep device battery consumption low.
