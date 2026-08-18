const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const FacultySchema = new mongoose.Schema(
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

    profilePhotoUrl: { type: String, default: "" },

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

    deviceLockEnabled: {
      type: Boolean,
      default: true,
    },

    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    allottedSubjects: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subject",
      },
    ],
  },
  { timestamps: true }
);

// Hash password if changed
FacultySchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash")) return next();
  if (typeof this.passwordHash === "string" && this.passwordHash.startsWith("$2")) {
    return next();
  }
  this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
  next();
});

module.exports = mongoose.model("Faculty", FacultySchema);
