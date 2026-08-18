const mongoose = require("mongoose");
const env = require("./env");

let isConnected = false;
let indexesSynced = false;

async function syncAppIndexes() {
  if (indexesSynced || !env.SYNC_INDEXES) return;

  const modelsToSync = [
    require("../models/Department"),
    require("../models/Subject"),
    require("../models/Student"),
    require("../models/Faculty"),
    require("../models/Session"),
    require("../models/Attendance"),
    require("../models/AttendanceAudit"),
    require("../models/SubjectAssignment"),
    require("../models/RegistrationToken"),
    require("../models/DeviceChangeRequest"),
  ];

  for (const model of modelsToSync) {
    try {
      await model.syncIndexes();
      console.log(`Indexes synced for ${model.modelName}`);
    } catch (err) {
      console.error(`Failed to sync indexes for ${model.modelName}:`, err.message);
    }
  }

  indexesSynced = true;
}

module.exports = async function connectDB() {
  if (isConnected) return;

  try {
    mongoose.set("strictQuery", true);

    await mongoose.connect(env.MONGO_URI, {
      autoIndex: env.MONGO_AUTO_INDEX,
      autoCreate: env.MONGO_AUTO_INDEX,
      maxPoolSize: env.MONGO_MAX_POOL_SIZE,
      minPoolSize: env.MONGO_MIN_POOL_SIZE,
      serverSelectionTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: env.MONGO_SOCKET_TIMEOUT_MS,
      retryWrites: true,
    });

    if (env.SYNC_INDEXES) {
      await syncAppIndexes();
    }

    isConnected = true;
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
};

mongoose.connection.on("disconnected", () => {
  isConnected = false;
  console.warn("MongoDB disconnected");
});
