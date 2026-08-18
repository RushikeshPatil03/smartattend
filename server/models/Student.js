const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const StudentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: { type: String, required: true },

    enrollmentNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    year: { type: Number, required: true },
    semester: { type: Number, required: true },
    section: { type: String, required: true, trim: true },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },

    deviceFingerprint: {
      type: String,
      required: true,
      index: true,
    },

    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    collegeName: { type: String, trim: true },
    profilePhotoUrl: { type: String, default: "" },
    faceSignature: { type: String, default: "" },
    faceSignatureMirror: { type: String, default: "" },
    faceSignatureVersion: { type: String, default: "" },
    faceEmbedding: { type: [Number], default: undefined },
    faceEmbeddingModel: { type: String, default: "" },
    faceEmbeddingVersion: { type: String, default: "" },

    registeredViaToken: { type: String, required: true },
  },
  { timestamps: true }
);

// Hash password if changed
StudentSchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash")) return next();
  if (typeof this.passwordHash === "string" && this.passwordHash.startsWith("$2")) {
    return next();
  }
  this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
  next();
});

StudentSchema.index({
  createdByAdmin: 1,
  department: 1,
  year: 1,
  semester: 1,
  section: 1,
});

module.exports = mongoose.model("Student", StudentSchema);
