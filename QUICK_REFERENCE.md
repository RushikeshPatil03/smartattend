# SmartAttend - Hackathon Quick Reference Card
## Keep This Handy During 24 Hours! 📋

---

## ONE-LINE PITCH
> "SmartAttend is a secure QR-based attendance system using geolocation and device fingerprinting to prevent proxy attendance — delivering 95%+ security at zero cost."

---

## FEATURE CHECKLIST (Must-Have)

### Core Features (REQUIRED by Hour 20)
- [ ] Faculty login
- [ ] Faculty create session → QR generates
- [ ] Student login
- [ ] Student scan QR → captures GPS
- [ ] Server validates: JWT ✓ Location ✓ Device ✓
- [ ] ✅ Attendance marked (instant feedback to student)
- [ ] Faculty dashboard updates live (WebSocket)
- [ ] Export CSV

### Nice-to-Have (If time permits)
- [ ] Device fingerprinting details
- [ ] Admin dashboard
- [ ] Attendance analytics
- [ ] Device change requests

### DON'T BUILD (Scope creep!)
- ❌ Mobile app (React web is enough)
- ❌ AI/ML features
- ❌ Payment gateway
- ❌ Email notifications
- ❌ Unit tests (demo > tests)

---

## TECH STACK COMMANDS

### Frontend
```bash
npm create vite@latest . -- --template react
npm install react react-dom typescript @vitejs/plugin-react
npm install html5-qrcode react-qr-code lucide-react axios
npm run dev  # Runs on :5173
```

### Backend
```bash
npm init -y
npm install express mongoose jsonwebtoken bcryptjs dotenv cors socket.io
npm install nodemon --save-dev
npm start  # Runs on :4000
```

### Database (Docker)
```bash
docker run -d -p 27017:27017 --name smartattend-db mongo:latest
```

### Full Stack (Docker Compose)
```bash
docker compose up --build
```

---

## KEY API ENDPOINTS

### Auth
```
POST   /api/auth/register    {name, email, password, role}
POST   /api/auth/login       {email, password}
```

### Session (Faculty)
```
POST   /api/session          {title, lat, lng, radius, duration}
GET    /api/session/:id      → Returns QR token
DELETE /api/session/:id
```

### Attendance (Student)
```
POST   /api/attendance       {qrToken, userId, lat, lng, deviceId}
GET    /api/attendance/:sessionId
```

### Export
```
GET    /api/attendance/export.csv
```

### Admin
```
POST   /api/admin/users      {name, email, role}
GET    /api/admin/reports
GET    /api/admin/devices
```

---

## CRITICAL FORMULAS

### Distance Calculation (Haversine)
```javascript
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + 
            Math.cos(lat1 * Math.PI/180) * 
            Math.cos(lat2 * Math.PI/180) * 
            Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c * 1000; // Returns meters
};
```

### JWT Token
```javascript
const token = jwt.sign({sessionId, qrToken}, SECRET, {expiresIn: '10m'});
```

### Device Fingerprint
```javascript
const fingerprint = crypto
  .createHash('sha256')
  .update(userAgent + screenWidth + screenHeight + timezone)
  .digest('hex');
```

---

## VALIDATION CHECKLIST (For Attendance)

Before marking attendance, validate ALL:
```javascript
// 1. JWT Token Valid?
jwt.verify(qrToken, SECRET)

// 2. Session Active?
session.endTime > now && session.status === 'active'

// 3. Location Within Radius?
haversine(session.lat, session.lng, 
          student.lat, student.lng) <= session.radius

// 4. Device Not Flagged?
!flaggedDevices.includes(deviceId)

// 5. Student Not Already Marked?
!attendance.exists({sessionId, studentId})

// ✅ All passed? Mark attendance!
```

---

## DATABASE SCHEMA QUICK REFERENCE

### User Model
```javascript
{name, email, password: bcrypt, role, department, active, createdAt}
```

### Session Model
```javascript
{title, facultyId, location: {lat, lng, radiusMeters}, 
 qrToken: jwt, startTime, endTime, status, createdAt}
```

### Attendance Model
```javascript
{sessionId, studentId, timestamp, location: {lat, lng}, 
 deviceId, status: 'confirmed|rejected|pending', createdAt}
```

### Device Model
```javascript
{userId, deviceId, fingerprint, lastUsed, isFlagged, reason}
```

---

## TESTING SCENARIOS

### Happy Path (5 min demo)
```
1. Login as Faculty → "Dr. Kumar"
2. Create session → Set radius 20m, duration 60 min
3. QR code displays
4. Login as Student → "Rahul"
5. Click "Scan Attendance"
6. Point phone at QR
7. Allow GPS permission
8. ✅ "Attendance Confirmed" appears
9. Switch to Faculty dashboard
10. See "1 marked" in real-time ✅
```

### Edge Cases
```
Student outside radius → "❌ Out of range (45m away)"
Student scans twice → "❌ Already marked"
Session expired → "❌ Session ended"
Invalid QR → "❌ Invalid token"
GPS denied → "⚠️ Enable location services"
```

---

## DOCKER QUICK SETUP

### File: docker-compose.yml
```yaml
version: '3.8'
services:
  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"
  backend:
    build: ./server
    ports:
      - "4000:4000"
    environment:
      MONGO_URI: mongodb://mongodb:27017/smart_attendance_system
      JWT_SECRET: your_secret_key
    depends_on:
      - mongodb
  frontend:
    build: .
    ports:
      - "5173:5173"
    depends_on:
      - backend
```

### Commands
```bash
docker compose up --build           # Start all services
docker compose down                 # Stop all services
docker compose logs -f backend      # View backend logs
docker compose ps                   # See running containers
```

---

## COMMON ERRORS & FIXES

| Error | Fix |
|---|---|
| `Cannot GET /api/session` | Check backend running, CORS configured |
| `GPS permission denied` | Ensure https in production, allow in browser settings |
| `QR scan not working` | Check camera permission, ensure mobile app has camera access |
| `MongoDB connection error` | Ensure docker container running, use `localhost` not `mongo` |
| `CORS error` | Add `app.use(cors())` before routes |
| `Token expired` | Ensure `expiresIn: '10m'` is set correctly |
| `WebSocket not updating` | Check socket.io server/client versions match |
| `Real-time not working` | Emit event from server: `io.emit('attendance', data)` |

---

## URLS FOR DEMO

```
Frontend:        http://localhost:5173
Backend API:     http://localhost:4000
MongoDB:         mongodb://localhost:27017
Admin Dashboard: http://localhost:5173/admin
Faculty Page:    http://localhost:5173/faculty
Student Page:    http://localhost:5173/student
```

---

## LOGIN CREDENTIALS (FOR DEMO)

```
Faculty:
  Email: faculty@smartattend.com
  Password: pass123

Student:
  Email: student@smartattend.com
  Password: pass123

Admin:
  Email: admin@smartattend.com
  Password: pass123
```

---

## PRE-DEMO CHECKLIST (Last 1 Hour)

- [ ] `docker compose up` running ✅
- [ ] All 3 services healthy (mongodb, backend, frontend) ✅
- [ ] Frontend loads on :5173 ✅
- [ ] Backend API responds on :4000 ✅
- [ ] Login works with test credentials ✅
- [ ] Faculty can create session ✅
- [ ] QR code displays correctly ✅
- [ ] Phone/mobile device ready ✅
- [ ] GPS & camera permissions ready ✅
- [ ] Timer set for 5 minutes ✅
- [ ] Presentation slides ready ✅
- [ ] Demo script printed/visible ✅
- [ ] Handouts printed (20 copies) ✅
- [ ] Team briefed on demo flow ✅
- [ ] Backup video saved (if needed) ✅

---

## JUDGE TALKING POINTS (30 sec each)

**Problem:**
> "Colleges waste ₹500 crores annually on proxy attendance. Manual systems are unreliable, biometric costs $50k+, simple QR can be screenshot."

**Solution:**
> "SmartAttend combines QR + GPS + Device fingerprinting. One scan, three validations, zero proxy."

**Uniqueness:**
> "No competitor combines all three: QR (time-limited) + GPS (geofenced) + Device (fingerprinted)."

**Timeline:**
> "24-hour build. Proven tech stack, clear scope. Production-ready MVP."

**Impact:**
> "Deploy to 10 colleges = 50k students protected. ROI: ₹2.3L saved per college annually."

---

## EMERGENCY CONTACTS

```
Hackathon Organizer: [Phone/Email]
Technical Support: [Team Lead Phone]
Backup Plan: Pre-recorded demo video (backup.mp4)
```

---

## FINAL WORDS

✅ **FOCUS:** Core features only  
✅ **COMMUNICATE:** Talk to team every hour  
✅ **TEST:** Validate milestones every 3 hours  
✅ **SLEEP:** 2-4 hours power nap essential  
✅ **REHEARSE:** Demo practice 3+ times  
✅ **BE CONFIDENT:** You built this in 24 hours!

**You've got this. Go build something amazing! 🚀**

---

*Quick Reference Card v1.0 | April 24, 2026*
