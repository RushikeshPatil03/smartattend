You are a Principal Software Architect, Distributed Systems Engineer, Backend Performance Expert, Security Engineer, and Code Reviewer.

## Focused Fix Validation - 2026-08-06

Run these checks after starting MongoDB/Redis and the API:

```bash
npm run build
npm run perf:load
LOAD_TEST_URL=http://localhost:5000/api/health LOAD_TEST_REQUESTS=250 LOAD_TEST_CONCURRENCY=25 npm run perf:load
```

Manual acceptance checklist:

- Selfie verification opens without an alignment square, corner guides, or tilt-angle cards.
- Move left in the selfie preview; the preview moves left, and the captured JPEG keeps that orientation.
- Student dashboard lists every started class session for today and shows `P` for present or `A` for absent.
- Admin generated registration link area scrolls when tall, the link is selectable, and `Copy` writes it to the clipboard.
- Face quality checks run at 4 FPS (`FACE_QUALITY_INTERVAL_MS = 250`) instead of every animation frame.
- QR scanning is throttled to 5 FPS (`SCAN_INTERVAL_MS = 200`) to reduce decode pressure.
- Under the basic load check, p95 latency should stay stable between repeated runs at the same concurrency.

Implementation notes:

- Frontend capture now resets canvas transforms before `drawImage`, and the video preview explicitly uses `transform: none`.
- Today attendance now queries eligible sessions first, then overlays present attendance records so missing records become absent rows.
- Existing Mongo indexes already cover student/date attendance lookups and session date/class filters. Run with `SYNC_INDEXES=true` when applying index changes in a controlled environment.

I will provide the complete source code of my QR-based Attendance System project.

Your task is to perform a FULL DEEP TECHNICAL AUDIT of the entire project.

====================================================
PROJECT ANALYSIS REQUIREMENTS
====================================================

Analyze and document:

1. HIGH LEVEL ARCHITECTURE
- Explain complete project architecture.
- Draw a text-based architecture diagram.
- Identify all modules and responsibilities.
- Explain request flow.
- Explain attendance marking flow.
- Explain QR generation flow.
- Explain QR validation flow.
- Explain WebSocket communication flow.
- Explain database interaction flow.

2. TECHNOLOGY STACK
Identify:
- Backend framework
- Frontend framework
- Database
- Authentication method
- WebSocket library
- Message broker (if any)
- Caching layer (if any)
- Cloud services used
- Deployment architecture

3. WEBSOCKET ANALYSIS
Perform a complete WebSocket audit:

- Number of active connections supported
- Current scalability limitations
- Connection lifecycle
- Reconnection strategy
- Heartbeat/ping-pong implementation
- Broadcast mechanism
- Room/channel architecture
- Memory consumption
- CPU usage impact
- Network overhead

Identify:
- Bottlenecks
- Anti-patterns
- Inefficient implementations
- Security vulnerabilities

Provide:
- Optimized architecture
- Recommended scaling strategy
- Redis Pub/Sub integration plan
- Horizontal scaling design
- Load balancing strategy

4. QR ATTENDANCE FLOW ANALYSIS

Explain:

Teacher Side:
- QR generation workflow
- Dynamic QR lifecycle
- QR refresh mechanism

Student Side:
- Scan workflow
- Validation workflow
- Attendance workflow

Identify:
- Security weaknesses
- Replay attack risks
- Spoofing risks
- QR sharing risks
- Location spoofing risks
- Session hijacking risks

Provide:
- Enterprise-grade secure design

5. PERFORMANCE AUDIT

Find:

- Slow queries
- N+1 query problems
- Excessive database calls
- Memory leaks
- Blocking operations
- Synchronous bottlenecks
- Unnecessary API calls
- Expensive loops
- Duplicate processing

Measure and estimate:

- Time complexity
- Space complexity
- Throughput
- Latency
- Scalability

6. CONCURRENCY ANALYSIS

Assume:

100 users
500 users
1000 users
5000 users
10000 users

For each level explain:

- What happens currently
- Expected bottlenecks
- Failure points
- Resource consumption

Provide:
- Recommended architecture changes

7. DATABASE REVIEW

Analyze:

- Schema design
- Relationships
- Indexes
- Constraints
- Query efficiency

Identify:

- Missing indexes
- Table scan risks
- Lock contention risks
- Redundant tables
- Normalization issues

Provide optimized schema suggestions.

8. SECURITY AUDIT

Check:

Authentication
Authorization
JWT usage
Session management
Password storage
API security
WebSocket security
QR security
Input validation
File upload security
Rate limiting
CSRF
XSS
SQL Injection
Privilege escalation

Provide:
- Vulnerability report
- Severity rating
- Fix recommendations

9. ATTENDANCE SYSTEM DOMAIN REVIEW

Evaluate:

- Proxy attendance prevention
- Dynamic QR effectiveness
- Multiple QR verification effectiveness
- Geolocation validation
- Device validation
- Browser fingerprinting
- Attendance fraud prevention

Suggest:
- Industry best practices
- Enterprise attendance workflow

10. CODE QUALITY REVIEW

Review:

- Folder structure
- Code organization
- Design patterns
- SOLID principles
- Clean architecture
- Reusability
- Maintainability

Provide:
- Refactoring recommendations

11. DEPLOYMENT REVIEW

Explain:

Current deployment architecture

Recommend:

Development setup
Staging setup
Production setup

Include:

Load Balancer
Reverse Proxy
Redis
Database
WebSocket Gateway
Monitoring
Logging

12. OBSERVABILITY

Recommend:

Metrics
Tracing
Logging

What should be monitored:

CPU
RAM
Network
DB Queries
WebSocket Connections
Attendance Requests

13. FINAL REPORT

Provide:

A. Current Architecture Score (/10)

B. Security Score (/10)

C. Scalability Score (/10)

D. Code Quality Score (/10)

E. Production Readiness Score (/10)

F. Maximum Estimated Concurrent Users

G. Top 20 Improvements Ranked by Impact

H. Exact Refactoring Roadmap

I. Exact Scalability Roadmap

J. Enterprise-Level Architecture Design

====================================================
OUTPUT FORMAT
====================================================

1. Executive Summary
2. Architecture Diagram
3. Module Analysis
4. WebSocket Analysis
5. QR Flow Analysis
6. Performance Audit
7. Database Audit
8. Security Audit
9. Scalability Audit
10. Code Quality Audit
11. Deployment Recommendations
12. Enterprise Architecture
13. Top 20 Improvements
14. Final Scores

Be extremely critical.
Do not assume anything.
Base conclusions only on the actual code.
Include code snippets wherever relevant.
Identify every performance, scalability, security, and architecture issue you can find.
