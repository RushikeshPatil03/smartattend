const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema(
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
    collegeName: { type: String, required: true, trim: true },
    profilePhotoUrl: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Admin", AdminSchema);
