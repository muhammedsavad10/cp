# Cold Payasam MVP (Stall 1 & Real-time Admin Monitoring)

A mobile-first web application for a local cold-payasam business featuring **Live Admin Real-Time Monitoring via WebSockets**. Built for **ONE STALL ONLY (Stall 1)** to test real stall worker usability before expanding to 5 stalls.

---

## 🌟 Key Features & Live Capabilities

1. **Live Admin Monitoring & Real-Time Sync**:
   - Built-in WebSocket server (`ws`) pushing updates instantly to all connected Admin dashboards.
   - When a stall worker taps **`SELL 1`**, records **Wastage**, confirms **Stock Receipt**, or submits **Close Day**, the Admin dashboard updates automatically without needing to refresh the page.
2. **Connection Status Tracking**:
   - Stall devices send heartbeats every 4-5 seconds.
   - Admin dashboard displays live status:
     - **🟢 Stall 1 Online** (with last activity timestamp)
     - **🟠 Stall 1 Offline** (with last synced timestamp)
3. **Live Stall Status Card**:
   - Stock Received
   - Total Glasses Sold
   - Recorded Wastage
   - Expected Remaining Stock (`Received - Sold - Wastage`)
   - Expected Revenue (`Sold × ₹40`)
   - Last Sale Timestamp (e.g. `10:42:31 AM`)
   - Current Status (`🟢 LIVE`)
4. **Real-Time Activity Feed**:
   - Dynamically generated from transaction records & WebSocket events:
     `10:42 AM — Stall 1 sold 1 Butter Fruit Payasam`
     `10:35 AM — Stall 1 confirmed receipt of 50 glasses`
5. **Mobile-First Stall Worker UI**:
   - Extra-large **`SELL 1`** button with click animation & double-click debouncing.
   - One-tap **`CONFIRM RECEIPT`** button for dispatches from admin/kitchen.
   - Append-only sales transactions.
   - End-of-day cash & UPI reconciliation with automated discrepancy calculation (🟢 MATCHED / 🔴 DISCREPANCY).

---

## 🔑 Demo Login Credentials

| Role | Email | Password | Allowed Access |
| :--- | :--- | :--- | :--- |
| **STALL USER** | `stall1@test.com` | `stall123` | Stall 1 dashboard, SELL 1, Confirm Receipt, Wastage, Close Day |
| **ADMIN** | `admin@test.com` | `admin123` | Real-time monitoring, Stock Dispatches, Sales audit, Money reconciliation, Reports |

---

## 🚀 How to Run Locally

### Prerequisites
- Node.js (v18+)
- npm (v9+)

### Installation & Build
```bash
npm install
npm --prefix client install
npm run build
```

### Start Server
Start the unified production server (REST API + WebSockets + React frontend on port 5000):
```bash
npm start
```
Access the application at **`http://localhost:5000`**.

### Development Mode
Runs Vite frontend dev server on port 3000 and backend on port 5000:
```bash
npm run dev
```

---

## 🧪 Automated Tests

1. **Real-Time WebSockets Test**:
   ```bash
   node test_realtime.js
   ```
2. **End-to-End Business Workflow Test**:
   ```bash
   npm run test:workflow
   ```
