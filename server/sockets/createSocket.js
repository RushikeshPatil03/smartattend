const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { createRedisDuplicate, shouldUseRedis } = require("../services/redisClient");
const { verifyAccessToken } = require("../services/tokenService");
const env = require("../config/env");

const SOCKET_LOGS_ENABLED = env.SOCKET_DEBUG;

/**
 * Attach Socket.IO to HTTP server.
 * Manages live session rooms and attendance notifications.
 */
module.exports = function createSocket(server) {
  const socketCorsOrigin = env.IS_PRODUCTION
    ? (env.CORS_ALLOW_ALL ? true : env.CORS_ORIGINS)
    : true;

  const io = new Server(server, {
    cors: {
      origin: socketCorsOrigin,
      credentials: true,
    },
    transports: ["websocket"],
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  if (shouldUseRedis()) {
    (async () => {
      try {
        const pubClient = await createRedisDuplicate();
        const subClient = await createRedisDuplicate();
        if (pubClient && subClient) {
          io.adapter(createAdapter(pubClient, subClient));
          console.log("Socket.IO Redis adapter enabled");
        }
      } catch (err) {
        console.error("Socket.IO Redis adapter unavailable:", err.message);
      }
    })();
  }

  async function emitLiveCount(sessionId, countOffset = 0) {
    const room = String(sessionId || "");
    if (!room) return;
    const sockets = await io.in(room).fetchSockets();
    io.to(room).volatile.emit("live-count", {
      sessionId,
      count: Math.max(0, sockets.length + countOffset),
    });
  }

  // ----------------------------------------------------
  // AUTH MIDDLEWARE (JWT) — SAFE + NON-CRASHING
  // ----------------------------------------------------
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const decoded = verifyAccessToken(token);
      socket.user = decoded; // { id, role, email }
      next();
    } catch (err) {
      console.error("Socket auth error:", err.message);
      return next(new Error("Invalid token"));
    }
  });

  // ----------------------------------------------------
  // CONNECTION HANDLING
  // ----------------------------------------------------
  io.on("connection", (socket) => {
    if (SOCKET_LOGS_ENABLED) {
      console.log("socket connected:", socket.id, socket.user?.role);
    }

    /**
     * Join a live attendance session room
     */
    socket.on("join-session", async (sessionId) => {
      if (!sessionId) return;

      const key = String(sessionId);
      socket.join(key);
      await emitLiveCount(key).catch((err) => {
        console.error("Socket live count error:", err.message);
      });
    });

    /**
     * Leave a live attendance session room
     */
    socket.on("leave-session", async (sessionId) => {
      if (!sessionId) return;

      const key = String(sessionId);
      socket.leave(key);
      await emitLiveCount(key).catch((err) => {
        console.error("Socket live count error:", err.message);
      });
    });

    /**
     * Handle disconnecting (still in rooms)
     */
    socket.on("disconnecting", async () => {
      for (const room of socket.rooms) {
        if (room === socket.id) continue;
        await emitLiveCount(room, -1).catch((err) => {
          console.error("Socket live count error:", err.message);
        });
      }
    });

    socket.on("disconnect", () => {
      if (SOCKET_LOGS_ENABLED) {
        console.log("socket disconnected:", socket.id);
      }
    });
  });

  // ----------------------------------------------------
  // EXTERNAL NOTIFIER (CALLED FROM ROUTES)
  // ----------------------------------------------------
  /**
   * Notify all clients in a session about attendance update
   * Used to push live presentees list
   */
  io.notifyAttendance = function (sessionId, payload) {
    if (!sessionId) return;
    io.to(String(sessionId)).emit("attendance", payload);
  };

  return io;
};
